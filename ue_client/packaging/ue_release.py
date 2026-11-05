#!/usr/bin/env python3
"""Stage the release files of ValdradaUE for one platform: the archives, the content files, the manifest that
fetch_valdrada_ue.py reads, and the checksums. Nothing is uploaded (release_bx/ue_publish.sh does that, on the owner's word).

  python3 ue_release.py --version 0.5.0 --platform linux --app out/archive/Shipping/Linux --core out/core_linux --out out/release/0.5.0
  python3 ue_release.py --version 0.5.0 --platform win64 --app <copied Windows archive>/Windows --core out/core_win64 --out out/release/0.5.0

Files written to --out (every one under GitHub's 2 GiB asset limit; P = ValdradaUE-<version>-<platform>):
  P-base.tar.gz | P-base.zip     the launcher, the README and licences, the Python package and its examples,
                                 fetch_valdrada_ue.py, and the renderer without its content: renderer/ (Unreal's start
                                 script or .exe, Engine/, ValdradaUE/Binaries, ValdradaUE/Data/city.json)
  P-core.tar.xz | P-core.zip     the headless core with its Node runtime and the compiled city's tiles (core_bundle.py)
  P-<pak file>                   each file of renderer/ValdradaUE/Content/Paks as it is (IoStore partitions keep each
                                 under the limit; a larger file would be cut into .001, .002 ... parts)
  ValdradaUE-<version>-tables.tar.xz.001 ...   the cells' kit tables named by city.json (both platforms share them)
  P.json                         the manifest: every item, its parts, sizes and SHA256, the mirrors
  P-SHA256SUMS.txt               sha256sum format, for checking by hand
Re-running reuses an archive whose inputs did not change (same file list, sizes and times) and rewrites the manifest.
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, tarfile, time, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SCHEMA = 'valdrada.ue.release/1'
GH_REPO = 'mkturkcan/valdrada'
HF_REPO = 'mehmetkeremturkcan/valdrada-ue'
LIMIT = 2 ** 31            # GitHub's per-asset limit (2 GiB)
CHUNK = 1 << 20


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(CHUNK * 8), b''):
            h.update(b)
    return h.hexdigest()


def walk(root, skip=lambda rel: False):
    out = []
    for dp, dn, fn in os.walk(root):
        dn.sort()
        for f in sorted(fn):
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root).replace(os.sep, '/')
            if not skip(rel):
                out.append((rel, p))
    return out


def fingerprint(entries):
    h = hashlib.sha256()
    for arc, p in entries:
        st = os.stat(p)
        h.update(f'{arc}\0{st.st_size}\0{int(st.st_mtime)}\n'.encode())
    return h.hexdigest()


def stamp_of(out):
    """Where the fingerprint of an archive's inputs is kept (beside the release files, not among them)."""
    d = os.path.join(os.path.dirname(out), '.stamps')
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, os.path.basename(out) + '.inputs')


def make_archive(out, entries, fmt, log):
    """entries: [(name in archive, source path)]. fmt: tar.gz, tar.xz, tar or zip. Skips the work when the inputs did not
    change since the last run (fingerprint file next to the archive)."""
    fp = fingerprint(entries)
    stamp = stamp_of(out)
    if os.path.exists(out) and os.path.exists(stamp) and open(stamp).read() == fp:
        log(f'  {os.path.basename(out)}: inputs unchanged, kept')
        return
    t0 = time.time()
    tmp = out + '.tmp'
    if fmt == 'zip':
        store = ('.ucas', '.utoc', '.pak', '.png', '.jpg', '.ktx2', '.glb', '.zip', '.whl', '.xz', '.gz')
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
            for arc, p in entries:
                z.write(p, arc, compress_type=zipfile.ZIP_STORED if arc.lower().endswith(store) else zipfile.ZIP_DEFLATED)
    else:
        xz = shutil.which('xz'); gz = shutil.which('pigz') or shutil.which('gzip')
        listfile = tmp + '.list'
        # a staging tree of hard links (or copies across file systems) holds the archive's names, then one tar call
        tree = tmp + '.tree'
        shutil.rmtree(tree, ignore_errors=True)
        for arc, p in entries:
            q = os.path.join(tree, arc)
            os.makedirs(os.path.dirname(q), exist_ok=True)
            try:
                os.link(p, q)
            except OSError:
                shutil.copy2(p, q)
        names = sorted({arc.split('/')[0] for arc, _ in entries})
        with open(listfile, 'w') as f:
            f.write('\n'.join(names) + '\n')
        comp = {'tar.xz': [xz, '-T0', '-6'] if xz else None, 'tar.gz': [gz, '-6'] if gz else None, 'tar': None}[fmt]
        if shutil.which('tar') and (comp or fmt == 'tar'):
            with open(tmp, 'wb') as f:
                tar = subprocess.Popen(['tar', '-C', tree, '--owner=0', '--group=0', '--numeric-owner', '-cf', '-', '-T', listfile],
                                       stdout=subprocess.PIPE if comp else f)
                if comp:
                    c = subprocess.Popen(comp + ['-c'], stdin=tar.stdout, stdout=f)
                    tar.stdout.close()
                    if c.wait() != 0:
                        sys.exit(f'{comp[0]} failed for {out}')
                if tar.wait() != 0:
                    sys.exit(f'tar failed for {out}')
        else:   # no system tools (Windows): Python's tarfile
            mode = {'tar.xz': 'w:xz', 'tar.gz': 'w:gz', 'tar': 'w'}[fmt]
            with tarfile.open(tmp, mode) as t:
                for arc, p in entries:
                    t.add(p, arc, recursive=False)
        shutil.rmtree(tree, ignore_errors=True)
        os.remove(listfile)
    os.replace(tmp, out)
    with open(stamp, 'w') as f:
        f.write(fp)
    log(f'  {os.path.basename(out)}: {len(entries)} files, {os.path.getsize(out) / 1e6:.1f} MB in {time.time() - t0:.0f} s')


def split(path, part_bytes, outdir, asset):
    """The asset as it is when it fits, else raw parts asset.001, .002 ... (byte ranges). Returns [(asset name, path)]."""
    size = os.path.getsize(path)
    if size <= part_bytes:
        dst = os.path.join(outdir, asset)
        if os.path.abspath(dst) != os.path.abspath(path):
            if os.path.exists(dst):
                os.remove(dst)
            try:
                os.link(path, dst)
            except OSError:
                shutil.copy2(path, dst)
        return [(asset, dst)]
    parts = []
    with open(path, 'rb') as f:
        i = 0
        while True:
            name = f'{asset}.{i + 1:03d}'
            dst = os.path.join(outdir, name)
            n = 0
            with open(dst, 'wb') as g:
                while n < part_bytes:
                    b = f.read(min(CHUNK * 8, part_bytes - n))
                    if not b:
                        break
                    g.write(b); n += len(b)
            if n == 0:
                os.remove(dst); break
            parts.append((name, dst)); i += 1
    if os.path.dirname(os.path.abspath(path)) == os.path.abspath(outdir):
        os.remove(path)
    return parts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--version', required=True)
    ap.add_argument('--platform', choices=['linux', 'win64'], required=True)
    ap.add_argument('--app', required=True, help='the packaged app: BuildCookRun archive folder Linux/ or Windows/')
    ap.add_argument('--core', required=True, help='the core bundle folder (core_bundle.py --out)')
    ap.add_argument('--city-json', default=os.path.join(REPO, 'ue_client', 'ValdradaUE', 'Data', 'city.json'))
    ap.add_argument('--tables', default='/data0/projectnyc_aux/ue_cache/cc/tables', help='the folder of the kit tables (.vcel)')
    ap.add_argument('--no-tables', action='store_true', help='leave the tables out (a renderer that does not read them)')
    ap.add_argument('--out', required=True, help='the release folder (both platforms can share it)')
    ap.add_argument('--part-mib', type=int, default=1900, help='the largest file to publish (MiB; default 1900)')
    ap.add_argument('--repo', default=REPO)
    ap.add_argument('--public-tree', default='/data0/projectnyc_aux/boundless-nyc',
                    help='the public release tree whose LICENSE, LICENSING.md, ACKNOWLEDGEMENTS.md and PythonAPI/ are shipped '
                         '(the published variants; default %(default)s, else --repo)')
    ap.add_argument('--project-name', default='ValdradaUE', help='the Unreal project inside the app folder (default %(default)s)')
    a = ap.parse_args()
    log = lambda *x: print(*x, flush=True)
    t_all = time.time()
    plat, ver = a.platform, a.version
    P = f'ValdradaUE-{ver}-{plat}'
    os.makedirs(a.out, exist_ok=True)
    part_bytes = a.part_mib * 2 ** 20
    assert part_bytes < LIMIT
    app = os.path.abspath(a.app)
    proj = a.project_name
    paks_rel = f'{proj}/Content/Paks'
    if not os.path.isdir(os.path.join(app, paks_rel)):
        sys.exit(f'no {paks_rel} in {app}: is --app the archive folder (Linux/ or Windows/)?')
    items = []

    def add_item(kind, name, src, parts, fmt=None, dest=None, mode=None):
        it = {'kind': kind, 'name': name, 'size': os.path.getsize(src) if src else sum(os.path.getsize(p) for _, p in parts),
              'sha256': None, 'parts': []}
        if fmt: it['format'] = fmt
        if dest: it['dest'] = dest
        if mode: it['mode'] = mode
        for asset, p in parts:
            it['parts'].append({'asset': asset, 'size': os.path.getsize(p), 'sha256': sha256(p)})
        if len(parts) == 1:
            it['sha256'] = it['parts'][0]['sha256']
        else:
            h = hashlib.sha256()
            for _, p in parts:
                with open(p, 'rb') as f:
                    for b in iter(lambda: f.read(CHUNK * 8), b''):
                        h.update(b)
            it['sha256'] = h.hexdigest()
        items.append(it)

    # 1. base: launcher, docs, licences, Python package, renderer without the paks
    log(f'{P}: base archive')
    lau = os.path.join(HERE, 'launcher')
    base = []
    if plat == 'linux':
        base.append(('ValdradaUE.sh', os.path.join(lau, 'ValdradaUE.sh')))
    else:
        base += [('ValdradaUE.bat', os.path.join(lau, 'ValdradaUE.bat')), ('launcher/ValdradaUE.ps1', os.path.join(lau, 'ValdradaUE.ps1'))]
    base.append(('README.md', os.path.join(lau, 'README.md')))
    base.append(('fetch_valdrada_ue.py', os.path.join(HERE, 'fetch_valdrada_ue.py')))
    pub = a.public_tree if a.public_tree and os.path.isdir(a.public_tree) else a.repo
    for f in ('LICENSE', 'LICENSING.md', 'ACKNOWLEDGEMENTS.md'):
        if os.path.exists(os.path.join(pub, f)):
            base.append((f, os.path.join(pub, f)))
    base.append(('UNREAL_ENGINE_NOTICE.md', os.path.join(lau, 'UNREAL_ENGINE_NOTICE.md')))
    # the walkers' own notice (the renderer draws the crowd's bodies since 0.7.0), as the web build ships it
    peds = os.path.join(a.repo, 'client', 'public', 'models', 'peds24', 'NOTICE.md')
    if os.path.exists(peds):
        base.append(('NOTICE_pedestrians.md', peds))
    base.append(('docs/ue-client.md', os.path.join(a.repo, 'docs', 'ue-client.md')))
    py = os.path.join(pub, 'PythonAPI')
    base += [('PythonAPI/' + rel, p) for rel, p in walk(py, lambda r: '__pycache__' in r or r.startswith(('build/', 'dist/', 'tests/')) or '.egg-info' in r)]
    base += [('renderer/' + rel, p) for rel, p in walk(app, lambda r: r.startswith(paks_rel + '/') or r.startswith(f'{proj}/Saved/'))]
    # the project's non-asset data the renderer reads from its Data/ folder (city.json, classes.json ...); the tables apart
    data_dir = os.path.dirname(os.path.abspath(a.city_json))
    for f in sorted(os.listdir(data_dir)) if os.path.isdir(data_dir) else []:
        if f.endswith('.json') and os.path.isfile(os.path.join(data_dir, f)):
            base.append((f'renderer/{proj}/Data/{f}', os.path.join(data_dir, f)))
    missing = [arc for arc, p in base if not os.path.exists(p)]
    if missing:
        sys.exit(f'missing inputs: {missing}')
    noexec = [arc for arc, p in base if arc.endswith('.sh') and not os.access(p, os.X_OK)]
    if noexec:
        sys.exit(f'not executable (chmod +x, and commit the mode): {noexec}')
    fmt = 'tar.gz' if plat == 'linux' else 'zip'
    arc = os.path.join(a.out, f'{P}-base.{fmt}')
    make_archive(arc, base, fmt, log)
    add_item('archive', f'{P}-base.{fmt}', arc, split(arc, part_bytes, a.out, os.path.basename(arc)), fmt='zip' if fmt == 'zip' else 'tar', dest='.')

    # 2. the core
    log(f'{P}: core archive')
    core = [('core/' + rel, p) for rel, p in walk(os.path.abspath(a.core))]
    fmt = 'tar.xz' if plat == 'linux' else 'zip'
    arc = os.path.join(a.out, f'{P}-core.{fmt}')
    make_archive(arc, core, fmt, log)
    add_item('archive', f'{P}-core.{fmt}', arc, split(arc, part_bytes, a.out, os.path.basename(arc)), fmt='zip' if fmt == 'zip' else 'tar', dest='.')

    # 3. the content files, as they are
    log(f'{P}: content files')
    for rel, p in walk(os.path.join(app, paks_rel)):
        add_item('file', f'renderer/{paks_rel}/{rel}', p, split(p, part_bytes, a.out, f'{P}-{rel}'))

    # 4. the kit tables city.json names (shared by both platforms)
    if not a.no_tables:
        log('tables archive')
        city = json.load(open(a.city_json))
        names = sorted(set(city['cells'].values()))
        tab = [(f'tables/{n}.vcel', os.path.join(a.tables, n + '.vcel')) for n in names]
        lost = [p for _, p in tab if not os.path.exists(p)]
        if lost:
            sys.exit(f'{len(lost)} tables named by city.json are missing, e.g. {lost[0]}')
        T = f'ValdradaUE-{ver}-tables.tar.xz'
        arc = os.path.join(a.out, T)
        whole = arc + '.whole'
        parts_exist = sorted(f for f in os.listdir(a.out) if f.startswith(T + '.0') or f == T)
        stamp = stamp_of(arc)
        if parts_exist and os.path.exists(stamp) and open(stamp).read() == fingerprint(tab):
            log(f'  {T}: inputs unchanged, kept')
            parts = [(f, os.path.join(a.out, f)) for f in parts_exist]
        else:
            for f in parts_exist:
                os.remove(os.path.join(a.out, f))
            make_archive(whole, tab, 'tar.xz', log)
            os.replace(stamp_of(whole), stamp)
            parts = split(whole, part_bytes, a.out, T)
            if os.path.exists(whole):
                os.remove(whole)
        add_item('archive', T, None, parts, fmt='tar', dest=f'renderer/{proj}/Data')

    # 5. manifest and checksums
    man = {'schema': SCHEMA, 'name': 'ValdradaUE', 'version': ver, 'platform': plat,
           'created': time.strftime('%Y-%m-%d %H:%M:%S'),
           'mirrors': {'github': f'https://github.com/{GH_REPO}/releases/download/v{ver}/',
                       'huggingface': f'https://huggingface.co/datasets/{HF_REPO}/resolve/v{ver}/'},
           'download_bytes': sum(p['size'] for it in items for p in it['parts']),
           'installed_bytes': None, 'items': items}
    # installed size: the files as they are, the archives as they unpack
    inst = sum(it['size'] for it in items if it['kind'] == 'file')
    inst += sum(os.path.getsize(p) for _, p in base) + sum(os.path.getsize(p) for _, p in core)
    if not a.no_tables:
        inst += sum(os.path.getsize(p) for _, p in tab)
    man['installed_bytes'] = inst
    mf = os.path.join(a.out, f'{P}.json')
    with open(mf, 'w') as f:
        json.dump(man, f, indent=1)
    with open(os.path.join(a.out, f'{P}-SHA256SUMS.txt'), 'w') as f:
        for it in items:
            for p in it['parts']:
                f.write(f'{p["sha256"]}  {p["asset"]}\n')
        f.write(f'{sha256(mf)}  {os.path.basename(mf)}\n')
    shutil.copy2(os.path.join(HERE, 'fetch_valdrada_ue.py'), os.path.join(a.out, 'fetch_valdrada_ue.py'))
    big = max(p['size'] for it in items for p in it['parts'])
    log(f'{P}: {len(items)} items in {sum(len(it["parts"]) for it in items)} files, download {man["download_bytes"] / 1e9:.2f} GB, '
        f'installed {inst / 1e9:.2f} GB, largest file {big / 2 ** 20:.0f} MiB, {time.time() - t_all:.0f} s -> {mf}')
    if big >= LIMIT:
        sys.exit('a file is over 2 GiB')


if __name__ == '__main__':
    main()
