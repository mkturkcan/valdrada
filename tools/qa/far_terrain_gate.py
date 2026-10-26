#!/usr/bin/env python3
# FARTERRAIN (2026-10-23): the near cells' ground against the far city's ground where one hands over to the other. For every
# terrain cell (UE_FAR_LIFT's list) the points along its four edges, 1 m inside (every 8 m): the near cell's ground (its
# class -1 mesh, the top surface) and the far ground that draws there when the cell is far (the block's GB_ package, else
# its L6 chunk's ground node, from the far library). Prints p50/p95/max |near - far| and the worst cells; exit 1 when the
# share of samples over --tol is above --share.
#   python3 tools/qa/far_terrain_gate.py --cells <json (its folder holds plain_cells/)> [--lib ue_cache/city_v2/farlib] [--tol 0.5] [--out <json>]
import argparse, json, os, struct, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ue'))
from r1c_lodprep import read

CC = '/data0/projectnyc_aux/cellcache'


def glb(p):
    f = open(p, 'rb').read(); L = struct.unpack('<I', f[12:16])[0]
    J = json.loads(f[20:20 + L]); o = 20 + L
    return J, f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]


def tris(p, pick):
    """world triangles (n, 3, 3) of the nodes pick(node) keeps, under the root's translation"""
    J, B = glb(p); root = J['nodes'][J['scenes'][0]['nodes'][0]]
    org = np.asarray(root.get('translation') or [0, 0, 0], np.float64); out = []
    for i in root.get('children') or []:
        n = J['nodes'][i]
        if 'mesh' not in n or not pick(n): continue
        t = np.asarray(n.get('translation') or [0, 0, 0], np.float64)
        for pr in J['meshes'][n['mesh']]['primitives']:
            P = read(J, B, pr['attributes']['POSITION']) + org + t
            I = read(J, B, pr['indices'], raw=True).reshape(-1, 3).astype(np.int64) if 'indices' in pr else np.arange(len(P)).reshape(-1, 3)
            out.append(P[I])
    return np.concatenate(out) if out else np.zeros((0, 3, 3))


def height(T, pts):
    """the highest surface of triangles T under each (x, z) point (nan where none)"""
    h = np.full(len(pts), np.nan)
    if not len(T): return h
    lo, hi = T[:, :, [0, 2]].min(1), T[:, :, [0, 2]].max(1)
    for q, (x, z) in enumerate(pts):
        c = np.nonzero((lo[:, 0] <= x) & (hi[:, 0] >= x) & (lo[:, 1] <= z) & (hi[:, 1] >= z))[0]
        if not len(c): continue
        a, b, d = T[c, 0], T[c, 1], T[c, 2]
        v0x, v0z, v1x, v1z = b[:, 0] - a[:, 0], b[:, 2] - a[:, 2], d[:, 0] - a[:, 0], d[:, 2] - a[:, 2]
        px, pz = x - a[:, 0], z - a[:, 2]
        den = v0x * v1z - v1x * v0z; ok = np.abs(den) > 1e-9
        u = np.where(ok, (px * v1z - v1x * pz) / np.where(ok, den, 1), -1); w = np.where(ok, (v0x * pz - px * v0z) / np.where(ok, den, 1), -1)
        inn = ok & (u >= -1e-6) & (w >= -1e-6) & (u + w <= 1 + 1e-6)
        if inn.any(): h[q] = float((a[inn, 1] + u[inn] * (b[inn, 1] - a[inn, 1]) + w[inn] * (d[inn, 1] - a[inn, 1])).max())
    return h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cells', required=True); ap.add_argument('--lib', default='/data0/projectnyc_aux/ue_cache/city_v2/farlib')
    ap.add_argument('--tol', type=float, default=0.5); ap.add_argument('--share', type=float, default=0.05); ap.add_argument('--out')
    a = ap.parse_args()
    cur = {}
    for i in range(3): cur.update({k: v['hash'] for k, v in json.load(open(f'{CC}/index/cityv2_{i}.json'))['cells'].items()})
    cells = [k for k in json.load(open(a.cells)) if k in cur]
    far = {}
    def far_ground(bx, bz):
        if (bx, bz) not in far:
            p = os.path.join(a.lib, f'GB_{bx}_{bz}.glb')
            if not os.path.exists(p): p = os.path.join(a.lib, f'L6_{bx // 8}_{bz // 8}.glb')
            far[(bx, bz)] = tris(p, lambda n: n.get('name') == 'ground') if os.path.exists(p) else np.zeros((0, 3, 3))
        return far[(bx, bz)]
    # (the cells' glbs are meshopt-compressed: decompressed once, by hash, with r1c_decomp.mjs)
    pd = os.path.join(os.path.dirname(a.cells), 'plain_cells'); os.makedirs(pd, exist_ok=True)
    jobs = [[os.path.join(CC, cur[k], 'cell.glb'), os.path.join(pd, cur[k] + '.glb')] for k in cells if not os.path.exists(os.path.join(pd, cur[k] + '.glb'))]
    jobs = [j for j in jobs if os.path.exists(j[0])]
    if jobs:
        import subprocess
        jp = os.path.join(pd, 'jobs.json'); json.dump(jobs, open(jp, 'w'))
        subprocess.check_call(['node', os.path.join(os.path.dirname(__file__), '..', 'ue', 'r1c_decomp.mjs'), jp], stdout=subprocess.DEVNULL)
    D, SD, per = [], [], {}
    for k in cells:
        cx, cz = map(int, k.split('_')); x0, z0 = cx * 128.0, cz * 128.0
        s = np.arange(4.0, 128.0, 8.0)
        pts = np.concatenate([np.stack([x0 + s, np.full_like(s, z0 + 1)], 1), np.stack([x0 + s, np.full_like(s, z0 + 127)], 1),
                              np.stack([np.full_like(s, x0 + 1), z0 + s], 1), np.stack([np.full_like(s, x0 + 127), z0 + s], 1)])
        cp = os.path.join(pd, cur[k] + '.glb')
        if not os.path.exists(cp): continue
        hn = height(tris(cp, lambda n: (n.get('extras') or {}).get('class') == -1), pts)
        hf = height(far_ground(cx // 8, cz // 8), pts)
        sd = (hn - hf)[np.isfinite(hn - hf)]; d = np.abs(sd)
        if len(d): D.append(d); SD.append(sd); per[k] = [float(np.median(d)), float(d.max()), int(len(d))]
    D = np.concatenate(D) if D else np.zeros(0)
    SD = np.concatenate(SD) if SD else np.zeros(0)
    r = {'signed_p50': float(np.median(SD)) if len(SD) else None, 'cells': len(per), 'samples': int(len(D)), 'p50': float(np.median(D)) if len(D) else None, 'p95': float(np.percentile(D, 95)) if len(D) else None,
         'max': float(D.max()) if len(D) else None, 'over_tol': float((D > a.tol).mean()) if len(D) else None,
         'worst': sorted(per.items(), key=lambda kv: -kv[1][0])[:15]}
    print(json.dumps(r))
    if a.out: json.dump({'summary': r, 'cells': per}, open(a.out, 'w'))
    sys.exit(0 if len(D) and r['over_tol'] <= a.share else 1)


if __name__ == '__main__':
    main()
