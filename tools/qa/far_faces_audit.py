#!/usr/bin/env python3
# FARFACE (2026-10-22): the far city's faces in Unreal. Per package kind of the far library (city_build.py far): the shells'
# buildings, triangles wound against their normals (Unreal culls them), buildings turned inside out (negative signed
# volume about their own centre), and open wall edges (a boundary edge that climbs, away from the
# package's square: B_ and R_ packages keep an L4 chunk's triangles by centroid, so a wall across a block line loses half). Then the far shell master's roughness against the presets' Lumen trace cut: a far shell
# glossier than r.Lumen.Reflections.MaxRoughnessToTrace mirrors its neighbours' shaded backs as sharp dark shapes, which
# read in a 5 km aerial as faces gone (trBdHarbour's Jersey City towers, ue11). Exit 1 on any finding.
#   python3 tools/qa/far_faces_audit.py [--lib /data0/projectnyc_aux/ue_cache/city_v2/farlib] [--jobs 24]
import argparse, collections, glob, json, os, re, struct, sys
from multiprocessing import Pool
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
UE = os.path.join(HERE, '..', 'ue')
sys.path.insert(0, UE)
from r1c_lodprep import read  # noqa: E402


def audit(f):
    b = open(f, 'rb').read(); L = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + L]); o = 20 + L
    B = b[o + 8:o + 8 + struct.unpack('<I', b[o:o + 4])[0]]
    r = collections.Counter()
    org = np.asarray(J['nodes'][J['scenes'][0]['nodes'][0]].get('translation') or [0, 0, 0], np.float64)
    for n in J['nodes']:
        if 'mesh' not in n or 'hells' not in (n.get('name') or ''): continue
        for pr in J['meshes'][n['mesh']]['primitives']:
            A = pr['attributes']
            if '_bkey' not in A or 'NORMAL' not in A or 'indices' not in pr: continue
            P = read(J, B, A['POSITION']); N = read(J, B, A['NORMAL']); K = read(J, B, A['_bkey'], raw=True)[:, 0]
            I = read(J, B, pr['indices'], raw=True).reshape(-1, 3).astype(np.int64)
            g = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]]); ok = np.linalg.norm(g, axis=1) > 1e-6
            I, g = I[ok], g[ok]
            if not len(I): continue
            r['tris'] += len(I)
            r['flipped_tris'] += int(((g * N[I].sum(1)).sum(1) < 0).sum())
            kt = K[I[:, 0]]; u, inv = np.unique(kt, return_inverse=True); cnt = np.bincount(inv)
            cen = np.stack([np.bincount(inv, P[I[:, 0]][:, d], len(u)) / cnt for d in range(3)], 1)
            Q = P[I] - cen[inv][:, None, :]
            vol = np.bincount(inv, np.einsum('ij,ij->i', Q[:, 0], np.cross(Q[:, 1], Q[:, 2])), len(u))
            r['buildings'] += len(u); r['inside_out'] += int((vol < 0).sum())
            # (the shells as one surface: buildings touch and share walls, and a package is cut on cell lines (a chunk's
            # square, a block's), where the neighbour package holds the rest; any other open vertical edge is a wall gone)
            U, w = np.unique(np.round(P * 20).astype(np.int64), axis=0, return_inverse=True); w = w.ravel(); T = w[I]
            E = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), 1)
            key, c = np.unique(E, axis=0, return_counts=True)
            bd = key[c == 1]; a_, b_ = U[bd[:, 0]] / 20.0, U[bd[:, 1]] / 20.0
            vert = (np.abs(a_[:, 0] - b_[:, 0]) < 0.06) & (np.abs(a_[:, 2] - b_[:, 2]) < 0.06) & (np.abs(a_[:, 1] - b_[:, 1]) > 0.5)
            on = lambda v, o_: np.abs((v + o_) / 128.0 - np.round((v + o_) / 128.0)) * 128.0 < 0.06   # (on a cell line)
            inner = vert & ~on(a_[:, 0], org[0]) & ~on(a_[:, 2], org[2])
            # (a wall line split differently on its two sides, a T-junction, covers each height twice: a hole covers it once)
            lines = collections.defaultdict(list)
            for p0, p1 in zip(a_[inner], b_[inner]):
                lines[(round(p0[0], 2), round(p0[2], 2))].append((min(p0[1], p1[1]), max(p0[1], p1[1])))
            for segs in lines.values():
                ys = sorted({y for sg in segs for y in sg})
                if any(y1 - y0 > 0.5 and sum(1 for s0, s1 in segs if s0 <= y0 and s1 >= y1) % 2 for y0, y1 in zip(ys, ys[1:])):
                    r['open_walls'] += 1
    return os.path.basename(f), r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lib', default='/data0/projectnyc_aux/ue_cache/city_v2/farlib'); ap.add_argument('--jobs', type=int, default=24)
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(a.lib, '*.glb')))
    tot = collections.defaultdict(collections.Counter); worst = []
    with Pool(a.jobs) as p:
        for name, r in p.imap_unordered(audit, files, chunksize=8):
            tot[name.split('_')[0]].update(r); tot['all'].update(r)
            if r['inside_out'] or r['open_walls']: worst.append((r['inside_out'] + r['open_walls'], name))
    for k in sorted(tot):
        t = tot[k]
        print(f"{k:5s} buildings {t['buildings']:8d} inside-out {t['inside_out']:5d} open walls {t['open_walls']:6d}  tris {t['tris']:9d} flipped {t['flipped_tris']:6d} ({100 * t['flipped_tris'] / max(t['tris'], 1):.3f} %)")
    if worst: print('most:', sorted(worst, reverse=True)[:8])
    # the far shell master's roughness against the presets' trace cut
    src = open(os.path.join(UE, 'r1c_lodmat.py')).read()
    m = re.search(r"Rough = lerp\(([0-9.]+), ([0-9.]+),", src.split('BDSHELL = ')[1])
    rmin = min(float(m.group(1)), float(m.group(2))) if m else 0.0
    cut = max([0.4] + [float(v) for p_ in glob.glob(os.path.join(UE, 'render_take_*.json'))
                       for v in re.findall(r'"r\.Lumen\.Reflections\.MaxRoughnessToTrace":\s*([0-9.]+)', open(p_).read())])
    print(f'far shell master: lowest roughness {rmin}, presets trace reflections up to {cut}:', 'ok' if rmin > cut else 'MIRRORS')
    t = tot['all']
    bad = rmin <= cut or t['inside_out'] > 0.001 * t['buildings'] or t['open_walls'] > 0.001 * t['buildings'] or t['flipped_tris'] > 0.001 * t['tris']
    print('FAIL' if bad else 'ok'); sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
