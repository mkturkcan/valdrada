"""The shared Unreal library's write lock (docs/notes/city-pipeline.md, 'Assets'): existing instances in /Game/MatLib (less
the cook's packed '_nan' copies and the owned sets of config/assets.json) and the facade masters in /Game/R2BD/Cell are kept
read-only on disk, so an editor cannot save over them (UE's package save will not replace a read-only file). Only
`city update`'s own build stage, with the integration line's tools, holds a bind token (CITY_BIND_TOKEN, a file under
locks/bind_tokens written by tools/city/stages_ue.py); with it, matlib.ensure opens exactly the folders it rebinds and closes
them again. Every other tool that would save there (bd_tilefac, r1c_bind, bindfac_all, rebind_pbr) refuses to start.
2026-10-27: the dioramas lane's tile prep (tools/dio/dio.py prep -> render_take.cc_blocks -> matlib.ensure -> r1c_bind)
rebound 43 shared instances outside any build, and the cook gate refused every cook after it."""
import contextlib, glob, json, os, stat, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CONTENT = os.path.join(ROOT, 'client', 'tools', 'ar34', 'export', 'ue_project', 'Content')
ROOTS = ('MatLib', 'R2BD/Cell')
LOCKS = os.path.join(os.environ.get('PNYC_AUX', '/data0/projectnyc_aux'), 'locks')


def _owned():
    try: A = json.load(open(os.path.join(ROOT, 'config', 'assets.json')))
    except Exception: return (), ('_nan',)
    return tuple(A.get('owned', {})), tuple(A.get('generated_by_cook', ['_nan']))


def protected(rel):
    """rel: path under Content ('MatLib/b.../x.uasset')"""
    if not rel.endswith('.uasset') or not rel.startswith(ROOTS): return False
    owned, cook = _owned(); b = os.path.basename(rel)
    if any(x in b for x in cook): return False
    if any(rel.startswith(p) or b.startswith(p) for p in owned): return False
    return True


def _files(folders=None):
    if folders is None: folders = ['/Game/' + r for r in ROOTS]
    for f in folders:
        d = os.path.join(CONTENT, f[len('/Game/'):])
        for p in glob.glob(os.path.join(d, '**', '*.uasset'), recursive=True):
            rel = os.path.relpath(p, CONTENT)
            if protected(rel): yield p


def _set(paths, writable):
    n = 0
    for p in paths:
        try:
            m = os.stat(p).st_mode
            nm = (m | stat.S_IWUSR) if writable else (m & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
            if nm != m: os.chmod(p, nm); n += 1
        except FileNotFoundError: pass
    return n


def protect_all():
    return _set(list(_files()), False)


def writable_count():
    return sum(1 for p in _files() if os.access(p, os.W_OK))


def _git(*a, cwd=ROOT):
    return subprocess.run(['git', *a], cwd=cwd, capture_output=True, text=True).stdout.strip()


def token():
    """the bind token of this process tree, if valid: written by city update's build stage, its process alive, made at
    the integration line's current head (the build's tools equal integration's: city update checked parity)"""
    p = os.environ.get('CITY_BIND_TOKEN')
    if not p or not os.path.realpath(p).startswith(os.path.join(LOCKS, 'bind_tokens')): return None
    try: t = json.load(open(p))
    except Exception: return None
    try: os.kill(int(t['pid']), 0)
    except Exception: return None
    if t.get('integration') != _git('rev-parse', 'integration'): return None
    return t


def require(what, folders):
    """refuse unless a bind token is held, when folders hold protected assets"""
    if token(): return
    hit = [f for f in folders if any(True for _ in _files([f]))]
    if hit:
        sys.stderr.write(f'{what}: refused: {hit[:3]} hold shared library instances, which only city update\'s build stage '
                         'may rebind (tools/ue/asset_guard.py). Run your change through city update, or bind into a new folder.\n')
        raise SystemExit(7)


@contextlib.contextmanager
def unlocked(folders, what):
    """the protected assets of these folders writable for the block, with a valid bind token; read-only again after
    (new files in them too)"""
    require(what, folders)
    files = list(_files(folders)); _set(files, True)
    try: yield
    finally: _set(list(_files(folders)), False)


# ==== the built city's readers and writers (2026-11-04): the deck's t7ArchTrack take was built and rendered (11:37 to
# 12:12) while v079's block stage imported blocks, and nothing told either of them. A take, a persistent-level render or a diorama render reads blocks, far levels, the library and the kit
# tables; the city build's block stage rewrites them in place (blocks-repair under the same key, the library rebound with
# the bind token). Readers share the read lock; the build holds it exclusively, so neither starts while the other runs.
READ_LOCK = os.path.join(LOCKS, 'ue_read.lock')
TURN_LOCK = os.path.join(LOCKS, 'ue_read.turn')   # (a waiting build stops new readers: takes on three GPUs never starve it)
_HELD = []


def _flock(path, mode, what, waiting, log):
    import fcntl
    os.makedirs(LOCKS, exist_ok=True)
    f = open(path, 'a+')
    try: fcntl.flock(f, mode | fcntl.LOCK_NB)
    except BlockingIOError:
        t = time.time(); log(f'{what}: waiting, {waiting}')
        fcntl.flock(f, mode)
        log(f'{what}: waited {time.time() - t:.0f} s')
    return f


def hold_read(what, log=print):
    """a reader for the rest of this process (released at exit): waits while a city build holds the content"""
    import fcntl
    why = 'a city build is rewriting blocks or the library (asset_guard.READ_LOCK)'
    t = _flock(TURN_LOCK, fcntl.LOCK_SH, what, why, log)
    _HELD.append(_flock(READ_LOCK, fcntl.LOCK_SH, what, why, log))
    fcntl.flock(t, fcntl.LOCK_UN); t.close()


@contextlib.contextmanager
def writing(what, log=print):
    """the city build's block stage: waits until every take and render reading the content has finished"""
    import fcntl
    why = 'takes or renders are reading the built city (asset_guard.READ_LOCK)'
    t = _flock(TURN_LOCK, fcntl.LOCK_EX, what, why, log)
    f = _flock(READ_LOCK, fcntl.LOCK_EX, what, why, log)
    try: yield
    finally:
        fcntl.flock(f, fcntl.LOCK_UN); f.close(); fcntl.flock(t, fcntl.LOCK_UN); t.close()


def stamp(levels):
    """the on-disk state of a world's levels (/Game/... level paths): {level: [mtime, size] or None}"""
    S = {}
    for l in levels:
        try: st = os.stat(os.path.join(CONTENT, l[len('/Game/'):] + '.umap')); S[l] = [st.st_mtime, st.st_size]
        except FileNotFoundError: S[l] = None
    return S


def changed(before):
    """the levels whose package changed on disk since stamp(): a take that read them mid-write is not a take"""
    now = stamp(list(before))
    return sorted(l for l in before if now[l] != before[l])
