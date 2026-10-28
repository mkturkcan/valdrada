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
