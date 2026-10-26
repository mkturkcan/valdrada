#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): lane B's far city (docs/specs/cell-package.md section 12) prepared for a persistent world that
# also holds lane A's cells for a region: every L6 chunk and landmark once, the L6 chunks over the region replaced by their
# four L5 children (the manager's rule: a chunk gives way to all its children), and every triangle whose centroid lies in
# the cells' region dropped (the cells draw the city there; landmarks inside it go whole), the shells' night chance
# (_lit) packed into TEXCOORD_1 for the shell master (UE drops custom attributes). Uncompressed glbs into --dst.
#   python3 tools/ue/r1c_lodprep.py --src /data0/projectnyc_aux/cellcache/plain/lod16 --region x0,z0,x1,z1 --dst <dir>
import argparse, json, math, os, struct
import numpy as np

CT = {5126: ('f4', 4), 5123: ('u2', 2), 5121: ('u1', 1), 5125: ('u4', 4), 5122: ('i2', 2), 5120: ('i1', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(J, B, i, raw=False):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    dt, sz = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or sz * n
    r = np.frombuffer(B, np.uint8, st * (a['count'] - 1) + sz * n, off)
    arr = np.lib.stride_tricks.as_strided(r, (a['count'], sz * n), (st, 1)).copy().view('<' + dt).reshape(a['count'], n)
    if raw: return arr
    arr = arr.astype(np.float64)
    if a.get('normalized') and dt != 'f4': arr /= {'u1': 255.0, 'u2': 65535.0, 'i1': 127.0, 'i2': 32767.0, 'u4': 4294967295.0}[dt]
    return arr


def clip_keep(W, I, keep, cell=128.0):
    """FARFACE (2026-10-22): the triangles over a set of cells (keys cx * 100000 + cz), cut exactly at the cell lines where
    the set's edge crosses them, as the chunks' own export clips its buildings at a square's edges. Keeping a triangle by
    its centroid left a wall across a block line half drawn (B_ packages: 21,864 open walls; R_: 1,240), a hole wherever
    the neighbour block is drawn by an L3 chunk or the cells. W: world positions; returns the kept original triangles and
    the new ones, as rows of (source triangle, three barycentric corners)."""
    kk = np.array(sorted(keep), np.int64)
    inset = lambda cx, cz: np.isin(cx * 100000 + cz, kk)
    T = W[I]
    lo = np.floor(T.min(1) / cell).astype(np.int64); hi = np.floor((T.max(1) - 1e-6) / cell).astype(np.int64)
    c = T.mean(1); cin = inset(np.floor(c[:, 0] / cell).astype(np.int64), np.floor(c[:, 2] / cell).astype(np.int64))
    one = (lo[:, 0] == hi[:, 0]) & (lo[:, 2] == hi[:, 2])
    mixed = np.zeros(len(I), bool)
    for t in np.nonzero(~one)[0]:
        cs = [inset(cx, cz) for cx in range(lo[t, 0], hi[t, 0] + 1) for cz in range(lo[t, 2], hi[t, 2] + 1)]
        mixed[t] = any(cs) and not all(cs)
    whole = ~mixed & cin
    new = []
    for t in np.nonzero(mixed)[0]:
        polys = [[np.eye(3)[0], np.eye(3)[1], np.eye(3)[2]]]
        for ax, a0, a1 in ((0, lo[t, 0], hi[t, 0]), (2, lo[t, 2], hi[t, 2])):
            for k in range(a0 + 1, a1 + 1):
                x = k * cell; out = []
                for poly in polys:
                    for side in (-1, 1):
                        q = []
                        for i in range(len(poly)):
                            u, v = poly[i], poly[(i + 1) % len(poly)]
                            du, dv = (u @ T[t][:, ax] - x) * side, (v @ T[t][:, ax] - x) * side
                            if du >= 0: q.append(u)
                            if (du >= 0) != (dv >= 0): q.append(u + (v - u) * (du / (du - dv)))
                        if len(q) >= 3: out.append(q)
                polys = out
        for poly in polys:
            cc = np.mean([b @ T[t] for b in poly], 0)
            if not inset(int(np.floor(cc[0] / cell)), int(np.floor(cc[2] / cell))): continue
            for i in range(1, len(poly) - 1):
                tri = np.array([poly[0], poly[i], poly[i + 1]])
                g = np.cross((tri[1] - tri[0]) @ T[t], (tri[2] - tri[0]) @ T[t])
                if g @ g > 1e-10: new.append((t, tri))
    return I[whole], new


_LIFT = None
SUBDIV = float(os.environ.get('UE_FAR_SUBDIV', '16'))   # (FARTERRAIN: the far ground's longest edge before the lift, m)


def far_lift():
    """FARTERRAIN (2026-10-23): the far city on the near cells' terrain. UE_FAR_LIFT=<json of the cells baked on the terrain>
    (UE_FAR_RELIEF: the five-borough far relief grid, boro_far.py's far_relief.bin + manifest farRelief): a far vertex over
    one of those cells is lifted by the relief at its x, z (per vertex, so a wall's foot and head lift alike), a vertex over
    a flat cell is not, so the far city stands on the same ground as the near cell it stands in for. None when unset."""
    global _LIFT
    if _LIFT is None:
        cp = os.environ.get('UE_FAR_LIFT')
        if not cp: _LIFT = False; return _LIFT
        rd = os.environ.get('UE_FAR_RELIEF', '/data0/projectnyc_aux/dev/v2/terrain/out/boro/client_city')
        h = json.load(open(os.path.join(rd, 'manifest.json')))['farRelief']
        v = np.fromfile(os.path.join(rd, h['f']), '<i2').astype(np.float64).reshape(h['nz'], h['nx']) / 100.0
        cells = {tuple(map(int, k.split('_'))) for k in json.load(open(cp))}
        _LIFT = {'h': h, 'v': v, 'cells': np.array(sorted(x * 100000 + z for x, z in cells), np.int64)}
    return _LIFT


def relief_at(x, z):
    """the far relief at world x, z (arrays), masked to the terrain-baked cells (0 elsewhere)"""
    L = far_lift()
    if not L: return np.zeros_like(x)
    h, v = L['h'], L['v']
    u = (x - h['x0']) / h['step']; w = (z - h['z0']) / h['step']
    i = np.clip(np.floor(u).astype(np.int64), 0, h['nx'] - 2); j = np.clip(np.floor(w).astype(np.int64), 0, h['nz'] - 2)
    a = np.clip(u - i, 0, 1); b = np.clip(w - j, 0, 1)
    r = (v[j, i] * (1 - a) + v[j, i + 1] * a) * (1 - b) + (v[j + 1, i] * (1 - a) + v[j + 1, i + 1] * a) * b
    out = (u < 0) | (w < 0) | (u > h['nx'] - 1) | (w > h['nz'] - 1)
    ck = np.floor(x / 128.0).astype(np.int64) * 100000 + np.floor(z / 128.0).astype(np.int64)
    return np.where(out | ~np.isin(ck, L['cells']), 0.0, r)


_WG = {}


def water_grid(dst):
    """FARPLATE (2026-10-23): the water of the L6 square a package lies in (its L6 chunk's water node), 8 m cells, for the
    rule that far ground never stands over water (UE_FAR_NOPLATE=1): mnHhp79's backdrop ground ran 1.5-6 m over the Hudson
    north of the city in a straight-edged lip. None for a package that names no square."""
    p = os.path.basename(dst)[:-4].split('_')
    try:
        if p[0] in ('L3', 'L4', 'L5', 'L6'): s_ = 2 ** (int(p[0][1]) - 3); bx, bz = int(p[1]) * s_, int(p[2]) * s_
        elif p[0] in ('B', 'GB', 'R'): bx, bz = int(p[1]), int(p[2])
        else: return None
    except ValueError: return None
    i6, j6 = bx // 8, bz // 8
    if (i6, j6) in _WG: return _WG[(i6, j6)]
    g = None
    try:
        ix = json.load(open('/data0/projectnyc_aux/cellcache/lod16/index.json'))
        e = ix['chunks'].get(f'L6_{i6}_{j6}')
        if e:
            src = f"/data0/projectnyc_aux/ue_cache/plain/{e['file'].split('/')[0]}.glb"
            f = open(src, 'rb').read(); L = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + L]); o = 20 + L
            B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
            root = J['nodes'][J['scenes'][0]['nodes'][0]]; org = np.asarray(root.get('translation') or [0, 0, 0], np.float64)
            x0, z0, S, n = i6 * 8192.0, j6 * 8192.0, 8.0, 1024
            g = {'x0': x0, 'z0': z0, 'S': S, 'n': n, 'm': np.zeros((n, n), bool)}
            from matplotlib.path import Path
            for nd in J['nodes']:
                ex = nd.get('extras') or {}
                if 'mesh' not in nd or not (ex.get('water') or ex.get('class') == 18): continue
                for pr in J['meshes'][nd['mesh']]['primitives']:
                    P = read(J, B, pr['attributes']['POSITION']) + org
                    I = read(J, B, pr['indices'], raw=True).reshape(-1, 3).astype(np.int64) if 'indices' in pr else np.arange(len(P)).reshape(-1, 3)
                    for t in P[I]:
                        i0, i1 = max(int((t[:, 0].min() - x0) // S), 0), min(int((t[:, 0].max() - x0) // S) + 1, n)
                        j0, j1 = max(int((t[:, 2].min() - z0) // S), 0), min(int((t[:, 2].max() - z0) // S) + 1, n)
                        if i1 <= i0 or j1 <= j0: continue
                        gx, gz = np.meshgrid(x0 + (np.arange(i0, i1) + 0.5) * S, z0 + (np.arange(j0, j1) + 0.5) * S)
                        g['m'][j0:j1, i0:i1] |= Path(t[:, [0, 2]]).contains_points(np.stack([gx.ravel(), gz.ravel()], 1)).reshape(gx.shape)
    except Exception:
        g = None
    _WG[(i6, j6)] = g
    return g


def over_water(g, c):
    """centroids c (n, 3) over the grid's water and more than 1 m above it (the water lies at 0)"""
    i = np.floor((c[:, 0] - g['x0']) / g['S']).astype(np.int64); j = np.floor((c[:, 2] - g['z0']) / g['S']).astype(np.int64)
    ok = (i >= 0) & (j >= 0) & (i < g['n']) & (j < g['n']); w = np.zeros(len(c), bool)
    w[ok] = g['m'][j[ok], i[ok]]
    return w & (c[:, 1] > 1.0)


_FD = {}


def feather_field():
    """FARPLATE2 (2026-10-23): the distance (m) from the city's land cells (cityv2 indexes: a cell over 1 m high), 32 m
    grid, for the rule that the backdrop's terrain meets the flat city: within UE_FAR_FEATHER m of the city's land the
    backdrop ground (and its buildings with it) is let down to the city's level by smoothstep, so a backdrop hill never
    ends at the city line in a straight-cut slab (mnHhp79: Yonkers' ground 30-80 m over the flat Bronx at the city limit)"""
    if 'f' in _FD: return _FD['f']
    from scipy import ndimage as ndi
    land = set()
    for i in range(3):
        try:
            for k, v in json.load(open(f'/data0/projectnyc_aux/cellcache/index/cityv2_{i}.json'))['cells'].items():
                if v['bounds'][4] > 1.0: land.add(tuple(map(int, k.split('_'))))
        except Exception: pass
    try:   # (not the bridges' landing cells outside the city: the GWB's in Fort Lee stand on the Palisades)
        land -= {tuple(map(int, k.split('_'))) for k in open('/data0/projectnyc_aux/ue_cache/city_v2/landing.txt').read().split()}
    except Exception: pass
    xs = [c[0] for c in land]; zs = [c[1] for c in land]
    S = 32.0; x0 = (min(xs) - 40) * 128.0; z0 = (min(zs) - 40) * 128.0
    nx = int(((max(xs) + 41) * 128.0 - x0) / S); nz = int(((max(zs) + 41) * 128.0 - z0) / S)
    m = np.ones((nz, nx), bool)
    for cx, cz in land:
        i0 = int((cx * 128.0 - x0) / S); j0 = int((cz * 128.0 - z0) / S); m[j0:j0 + 4, i0:i0 + 4] = False
    _FD['f'] = {'x0': x0, 'z0': z0, 'S': S, 'd': ndi.distance_transform_edt(m) * S}
    return _FD['f']


def feather_k(x, z, R):
    F = feather_field()
    i = np.clip(((x - F['x0']) / F['S']).astype(np.int64), 0, F['d'].shape[1] - 1); j = np.clip(((z - F['z0']) / F['S']).astype(np.int64), 0, F['d'].shape[0] - 1)
    t = np.clip(F['d'][j, i] / R, 0, 1)
    return t * t * (3 - 2 * t)


_MK = None
def marina_out(C):
    """MARINA (2026-10-24): the far city's triangles over the marina kit's slab-out polygons (the dock outlines the sources drew
    as land; public/data/marinas/marinas.json, UE_FAR_MARINA=<path>) standing over the water: the near cells' kit draws the
    docks, and a water cell holds no near cell to mask the far slabs. C: centroids (n, 3); True where dropped"""
    global _MK
    p = os.environ.get('UE_FAR_MARINA')
    if not p: return None
    if _MK is None:
        from matplotlib.path import Path
        _MK = []
        for t in json.load(open(p))['tiles'].values():
            for r in t.get('slabOut') or []:
                a = np.asarray(r, np.float64); _MK.append((a[:, 0].min(), a[:, 1].min(), a[:, 0].max(), a[:, 1].max(), Path(a)))
    out = np.zeros(len(C), bool)
    if not len(C): return out
    for x0, z0, x1, z1, pa in _MK:
        m = (C[:, 0] >= x0) & (C[:, 0] <= x1) & (C[:, 2] >= z0) & (C[:, 2] <= z1) & (C[:, 1] > 0.3)
        if m.any(): out[np.where(m)[0][pa.contains_points(C[m][:, [0, 2]])]] = True
    return out


def prep(src, dst, rect, only=None, mask_backdrop=False, keep=None):
    # FARTERRAIN: how this package follows the terrain (far_lift): bridges keep their own deck lines, a landmark lifts whole
    base_ = os.path.basename(dst)
    lift_mode = None if not far_lift() else ('none' if base_.startswith(('LMB_', 'LMBR_', 'W_')) else 'rigid' if base_.startswith('LM_') else 'vertex')
    f = open(src, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]
    J = json.loads(f[20:20 + L]); o = 20 + L
    B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
    root = J['nodes'][J['scenes'][0]['nodes'][0]]
    org = np.asarray(root.get('translation') or [0, 0, 0], np.float64)
    # ==== R2B: `only` (a set of node names, e.g. {'ground', 'water'}): the other nodes are dropped (an L6 package the load
    # set does not draw gives its persistent parts alone: its ground, masked under the cells as ever, and its water)
    drop_meshes = set()
    if only is not None:
        kids = root.get('children') or []
        kept = [i for i in kids if J['nodes'][i].get('name') in only]   # (not `keep`: that is the cells an edge package keeps)
        drop_meshes = {J['nodes'][i]['mesh'] for i in kids if i not in kept and 'mesh' in J['nodes'][i]}
        root['children'] = kept
    # ==== end R2B
    extra = bytearray(); base = len(B) + (-len(B)) % 4; pad0 = b'\0' * (base - len(B))
    st = {'tris_in': 0, 'tris_out': 0}
    made = {}   # (FARFACE: the accessors this file adds, by index, with their data)

    def add(arr, comp, typ):
        data = np.ascontiguousarray(arr).tobytes()
        off = base + len(extra)
        J['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
        extra.extend(data + b'\0' * ((-len(data)) % 4))
        acc = {'bufferView': len(J['bufferViews']) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if typ == 'VEC2': acc['min'] = arr.min(0).astype(float).tolist(); acc['max'] = arr.max(0).astype(float).tolist()
        J['accessors'].append(acc); made[len(J['accessors']) - 1] = arr
        return len(J['accessors']) - 1
    # ==== R2B (2026-10-11): the water (an L6 chunk's `water` node, docs/specs/cell-package.md sections 7 and 12) is not
    # masked under the cells: the cells hold no water, land in them stands ~3 m over it and their river beds ~3.6 m under it
    water_meshes = {n['mesh'] for n in J.get('nodes', []) if 'mesh' in n and ((n.get('extras') or {}).get('water') or (n.get('extras') or {}).get('class') == 18)}
    # (BD40: the backdrop's nodes (extras.backdrop) lie outside the city, where no cell draws: never masked under the cells,
    # which only hold the New Jersey landing patches there, 0.3 m over the backdrop's ground)
    # (GB43: mask_backdrop, the city's edge packages: a chunk cut to one block, its backdrop too)
    if not mask_backdrop: water_meshes |= {n['mesh'] for n in J.get('nodes', []) if 'mesh' in n and (n.get('extras') or {}).get('backdrop')}
    st['water_tris'] = 0
    # ==== end R2B
    rigid_dy = None
    ground_meshes = {n['mesh'] for n in J.get('nodes', []) if 'mesh' in n and n.get('name') == 'ground'}
    plate_meshes = {n['mesh'] for n in J.get('nodes', []) if 'mesh' in n and n.get('name') in ('ground', 'bdGround')}
    FR = float(os.environ.get('UE_FAR_FEATHER') or 0)
    bd_meshes = {n['mesh'] for n in J.get('nodes', []) if 'mesh' in n and n.get('name') in ('bdGround', 'bdShells')}
    bdg = None
    if FR > 0 and bd_meshes:   # (FARPLATE2: the backdrop ground's height under each point, 16 m cells, for its buildings)
        from matplotlib.path import Path
        G_ = [read(J, B, pr['attributes']['POSITION']) + org for n in J['nodes'] if 'mesh' in n and n.get('name') == 'bdGround'
              for pr in J['meshes'][n['mesh']]['primitives']]
        Gi = [read(J, B, pr['indices'], raw=True).reshape(-1, 3).astype(np.int64) for n in J['nodes'] if 'mesh' in n and n.get('name') == 'bdGround'
              for pr in J['meshes'][n['mesh']]['primitives']]
        if G_:
            Tg = np.concatenate([P_[I_] for P_, I_ in zip(G_, Gi)])
            gx0, gz0, gS = float(Tg[:, :, 0].min()), float(Tg[:, :, 2].min()), 16.0
            gnx, gnz = int((Tg[:, :, 0].max() - gx0) / gS) + 1, int((Tg[:, :, 2].max() - gz0) / gS) + 1
            hg = np.zeros((gnz, gnx))
            for t in Tg:
                i0, i1 = int((t[:, 0].min() - gx0) // gS), int((t[:, 0].max() - gx0) // gS) + 1; j0, j1 = int((t[:, 2].min() - gz0) // gS), int((t[:, 2].max() - gz0) // gS) + 1
                gx, gz = np.meshgrid(gx0 + (np.arange(i0, i1) + 0.5) * gS, gz0 + (np.arange(j0, j1) + 0.5) * gS)
                mm = Path(t[:, [0, 2]]).contains_points(np.stack([gx.ravel(), gz.ravel()], 1)).reshape(gx.shape)
                sub = hg[j0:j1, i0:i1]; sub[mm] = np.maximum(sub[mm], t[:, 1].mean())
            bdg = (gx0, gz0, gS, hg)
    plate_g = water_grid(dst) if os.environ.get('UE_FAR_NOPLATE') == '1' and plate_meshes else None
    if lift_mode == 'rigid':   # (FARTERRAIN: a landmark whole, by the relief at its footprint's centre)
        lo_, hi_ = np.full(3, 1e18), np.full(3, -1e18)
        for mi_, mesh in enumerate(J['meshes']):
            if mi_ in drop_meshes or mi_ in water_meshes: continue
            for pr in mesh['primitives']:
                P_ = read(J, B, pr['attributes']['POSITION']) + org; lo_ = np.minimum(lo_, P_.min(0)); hi_ = np.maximum(hi_, P_.max(0))
        if lo_[0] < hi_[0]: rigid_dy = float(relief_at(np.array([(lo_[0] + hi_[0]) / 2]), np.array([(lo_[2] + hi_[2]) / 2]))[0])
    st['lift_max'] = 0.0
    for mi_, mesh in enumerate(J['meshes']):
        if mi_ in drop_meshes:   # (R2B: a dropped node's mesh keeps one degenerate triangle: nothing draws it, the file stays valid)
            for pr in mesh['primitives']: pr['indices'] = add(np.zeros(3, '<u4'), 5125, 'SCALAR')
            continue
        for pr in mesh['primitives']:
            P = read(J, B, pr['attributes']['POSITION']) + org
            I = read(J, B, pr['indices'], raw=True).reshape(-1, 3).astype(np.int64) if 'indices' in pr else np.arange(len(P)).reshape(-1, 3)
            st['tris_in'] += len(I); I0 = I
            if mi_ in water_meshes: st['water_tris'] += len(I)   # (R2B)
            newt = []
            if keep is not None and mi_ not in water_meshes:   # (GB43: only the triangles over these cells, an edge package's own;
                I, newt = clip_keep(P, I, keep)                 # FARFACE: cut at the cells' lines, not kept by centroid)
            if rect is not None and mi_ not in water_meshes:
                c = P[I].mean(1)
                if isinstance(rect, set):   # (the drawn cells' squares: a load set's mask)
                    keys = np.floor(c[:, 0] / 128.0).astype(np.int64) * 100000 + np.floor(c[:, 2] / 128.0).astype(np.int64)
                    inside = np.isin(keys, np.array(sorted(rect), np.int64))
                else:
                    inside = (c[:, 0] > rect[0]) & (c[:, 0] < rect[2]) & (c[:, 2] > rect[1]) & (c[:, 2] < rect[3])
                I = I[~inside]
            NC = [I0[t] for t, _ in newt]; NB = [b for _, b in newt]
            if plate_g is not None and mi_ in plate_meshes and len(I):   # (FARPLATE: no far ground over water)
                I = I[~over_water(plate_g, P[I].mean(1))]
                if NB:
                    keep_ = ~over_water(plate_g, np.einsum('ncj,njk->nck', np.array(NB), P[np.array(NC)]).mean(1))
                    NC = [x for x, k_ in zip(NC, keep_) if k_]; NB = [x for x, k_ in zip(NB, keep_) if k_]
            if os.environ.get('UE_FAR_MARINA') and mi_ not in water_meshes and len(I):   # (MARINA: no far slab over a marina's water)
                mo = marina_out(P[I].mean(1)); st['marina_tris'] = st.get('marina_tris', 0) + int(mo.sum()); I = I[~mo]
                if NB:
                    keep_ = ~marina_out(np.einsum('ncj,njk->nck', np.array(NB), P[np.array(NC)]).mean(1))
                    NC = [x for x, k_ in zip(NC, keep_) if k_]; NB = [x for x, k_ in zip(NB, keep_) if k_]
            if lift_mode == 'vertex' and mi_ in ground_meshes and len(I):   # (FARTERRAIN: the far ground's long triangles split to
                # SUBDIV m or less before the lift, so its surface follows the relief between its corners as the near ground does)
                W_ = P[I]; e_ = np.stack([np.hypot(W_[:, a_, 0] - W_[:, b_, 0], W_[:, a_, 2] - W_[:, b_, 2]) for a_, b_ in ((0, 1), (1, 2), (2, 0))], 1).max(1)
                lg = e_ > SUBDIV
                NC += list(I[lg]); NB += [np.eye(3)] * int(lg.sum()); I = I[~lg]
            NC = np.array(NC, np.int64).reshape(-1, 3); NB = np.array(NB, np.float64).reshape(-1, 3, 3)
            if lift_mode == 'vertex' and mi_ in ground_meshes and len(NC):
                for _ in range(8):
                    W_ = np.einsum('ncj,njk->nck', NB, P[NC])
                    e_ = np.stack([np.hypot(W_[:, a_, 0] - W_[:, b_, 0], W_[:, a_, 2] - W_[:, b_, 2]) for a_, b_ in ((0, 1), (1, 2), (2, 0))], 1).max(1)
                    sp = e_ > SUBDIV
                    if not sp.any(): break
                    b0, b1, b2 = NB[sp, 0], NB[sp, 1], NB[sp, 2]; m01, m12, m20 = (b0 + b1) / 2, (b1 + b2) / 2, (b2 + b0) / 2
                    kids = np.concatenate([np.stack(q, 1) for q in ((b0, m01, m20), (m01, b1, m12), (m20, m12, b2), (m01, m12, m20))])
                    NC = np.concatenate([NC[~sp], np.tile(NC[sp], (4, 1))]); NB = np.concatenate([NB[~sp], kids])
            st['tris_out'] += len(I)
            if not len(NC): pr['indices'] = add(I.astype('<u4').reshape(-1), 5125, 'SCALAR')
            if '_lit' in pr['attributes']:
                lit = read(J, B, pr['attributes']['_lit'])[:, 0]
                if 'TEXCOORD_0' not in pr['attributes']: pr['attributes']['TEXCOORD_0'] = add(np.zeros((len(P), 2), '<f4'), 5126, 'VEC2')
                # (BD40: the vertex's open-sky share, _ao, in TEXCOORD_1.y for the lane's far master's AO input; 0 where none)
                aov = read(J, B, pr['attributes']['_ao'])[:, 0] if '_ao' in pr['attributes'] else np.zeros_like(lit)
                pr['attributes']['TEXCOORD_1'] = add(np.stack([lit, aov], 1).astype('<f4'), 5126, 'VEC2')
            if len(NC):   # (FARFACE: the cut triangles' corners appended to every attribute, interpolated; their indices after)
                nv = len(P); bary = NB; corners = NC   # (n, 3 corners, 3); FARTERRAIN: the split triangles too
                for an, ai in list(pr['attributes'].items()):
                    acc = J['accessors'][ai]; raw = made[ai] if ai in made else read(J, B, ai, raw=True)
                    raw = raw.reshape(len(raw), -1)
                    v = np.einsum('ncj,njk->nck', bary, raw[corners].astype(np.float64)).reshape(-1, raw.shape[1])
                    if raw.dtype.kind in 'iu': v = np.clip(np.rint(v), np.iinfo(raw.dtype).min, np.iinfo(raw.dtype).max)
                    full = np.concatenate([raw, v.astype(raw.dtype)])
                    k_ = add(full, acc['componentType'], acc['type'])
                    if acc.get('normalized'): J['accessors'][k_]['normalized'] = True
                    if an == 'POSITION':
                        J['accessors'][k_]['min'] = full.min(0).astype(float).tolist(); J['accessors'][k_]['max'] = full.max(0).astype(float).tolist()
                    pr['attributes'][an] = k_
                I = np.concatenate([I, nv + np.arange(3 * len(NC)).reshape(-1, 3)])
                pr['indices'] = add(I.astype('<u4').reshape(-1), 5125, 'SCALAR')
                st['tris_out'] += len(NC); st['cut_tris'] = st.get('cut_tris', 0) + len(newt)
            if FR > 0 and mi_ in bd_meshes:   # (FARPLATE2: the backdrop let down to the flat city near its land)
                ai = pr['attributes']['POSITION']; Pl = (made[ai] if ai in made else read(J, B, ai)).astype(np.float64).copy()
                wx, wz = Pl[:, 0] + org[0], Pl[:, 2] + org[2]
                k_f = feather_k(wx, wz, FR)
                if np.any(k_f < 1):
                    if bdg is not None:
                        gx0, gz0, gS, hg = bdg
                        gi = np.clip(((wx - gx0) / gS).astype(np.int64), 0, hg.shape[1] - 1); gj = np.clip(((wz - gz0) / gS).astype(np.int64), 0, hg.shape[0] - 1)
                        hb_ = np.maximum(hg[gj, gi], 0.0)
                    else: hb_ = np.zeros(len(Pl))
                    gnd = np.maximum(Pl[:, 1] + org[1], 0.0) if mi_ in plate_meshes else hb_
                    Pl[:, 1] -= (1 - k_f) * gnd
                    k2 = add(Pl.astype('<f4'), 5126, 'VEC3'); J['accessors'][k2]['min'] = Pl.min(0).tolist(); J['accessors'][k2]['max'] = Pl.max(0).tolist()
                    pr['attributes']['POSITION'] = k2; st['feathered'] = st.get('feathered', 0) + int((k_f < 1).sum())
            if lift_mode in ('vertex', 'rigid') and mi_ not in water_meshes:   # (FARTERRAIN: far_lift, on the final vertices)
                ai = pr['attributes']['POSITION']; Pl = (made[ai] if ai in made else read(J, B, ai)).astype(np.float64).copy()
                dy = relief_at(Pl[:, 0] + org[0], Pl[:, 2] + org[2]) if lift_mode == 'vertex' else np.full(len(Pl), rigid_dy or 0.0)
                if np.any(dy != 0):
                    Pl[:, 1] += dy
                    k_ = add(Pl.astype('<f4'), 5126, 'VEC3'); J['accessors'][k_]['min'] = Pl.min(0).tolist(); J['accessors'][k_]['max'] = Pl.max(0).tolist()
                    pr['attributes']['POSITION'] = k_
                    st['lift_max'] = max(st['lift_max'], float(np.abs(dy).max()))
    if drop_meshes:   # (R2B: the dropped nodes and their meshes out of the file, the kept nodes' mesh indices renumbered)
        keep_m = [i for i in range(len(J['meshes'])) if i not in drop_meshes]
        remap = {o: n for n, o in enumerate(keep_m)}
        J['meshes'] = [J['meshes'][i] for i in keep_m]
        for n in J['nodes']:
            if 'mesh' in n:
                if n['mesh'] in remap: n['mesh'] = remap[n['mesh']]
                else: n.pop('mesh')
    NB = B + pad0 + bytes(extra)
    J['buffers'][0]['byteLength'] = len(NB)
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    with open(dst, 'wb') as w:
        w.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(NB)))
        w.write(struct.pack('<II', len(js), 0x4E4F534A)); w.write(js)
        w.write(struct.pack('<II', len(NB), 0x004E4942)); w.write(NB)
    if os.environ.get('UE_FAR_COVER') == '1' and only is None:   # (NJCOVER: the backdrop's tree crowns, canopy and rock, bd_cover.py)
        import bd_cover
        cv = bd_cover.apply(dst)
        if cv: st['cover'] = cv
    return st


# ==== R2B (2026-10-11): an L6 package the load set does not draw (finer levels draw its square) gives its water alone:
# a glb of the root and its `water` nodes (the far level's water is drawn whole, whichever level draws the square)
def prep_water(src, dst):
    f = open(src, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]
    J = json.loads(f[20:20 + L]); o = 20 + L
    B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
    ri = J['scenes'][0]['nodes'][0]; root = dict(J['nodes'][ri])
    isw = lambda n: 'mesh' in n and ((n.get('extras') or {}).get('water') or (n.get('extras') or {}).get('class') == 18)
    wn = [i for i in (root.get('children') or []) if isw(J['nodes'][i])]
    if not wn: return None
    meshes, nodes, tris = [], [], 0
    for i in wn:
        n = dict(J['nodes'][i]); m = J['meshes'][n['mesh']]; meshes.append(m); n['mesh'] = len(meshes) - 1; nodes.append(n)
        for pr in m['primitives']: tris += J['accessors'][pr['indices']]['count'] // 3 if 'indices' in pr else J['accessors'][pr['attributes']['POSITION']]['count'] // 3
    root['children'] = list(range(1, 1 + len(nodes)))
    J2 = {k: v for k, v in J.items() if k not in ('nodes', 'meshes', 'scenes', 'scene')}
    J2['nodes'] = [root] + nodes; J2['meshes'] = meshes; J2['scenes'] = [{'nodes': [0]}]; J2['scene'] = 0
    js = json.dumps(J2, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    NB = B + b'\0' * ((-len(B)) % 4)
    with open(dst, 'wb') as w:
        w.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(NB)))
        w.write(struct.pack('<II', len(js), 0x4E4F534A)); w.write(js)
        w.write(struct.pack('<II', len(NB), 0x004E4942)); w.write(NB)
    return {'tris_in': tris, 'tris_out': tris, 'water_tris': tris}
# ==== end R2B


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True); ap.add_argument('--dst', required=True)
    ap.add_argument('--region', default=None, help='x0,z0,x1,z1: the cells\' region in world metres')
    ap.add_argument('--l5', default='auto', help='auto: the L5 children of the L6 chunks over the region; none')
    ap.add_argument('--mask-dir', default=None, help='comma-separated folders of <cx>_<cz>.glb cells: the mask (default: the load set\'s drawn cells)')
    ap.add_argument('--loadset', default=None, help='a take\'s load set: its drawn chunks and landmarks from --src (r1c_plain.mjs\'s <key>.glb), masked under its drawn cells')
    ap.add_argument('--water-src', default=None, help='(R2B) a folder of <key>.glb L6 packages the load set does not draw: their water alone, as W_<key>.glb')
    a = ap.parse_args()
    if a.loadset:
        LS = json.load(open(a.loadset))
        cells = sorted({c for f in LS['frames'] for c in f.get('cells', [])})
        if a.mask_dir:   # (the cells this world actually holds: lane A's batches beyond the load set's baked ones)
            cells = sorted({fn[:-4] for d in a.mask_dir.split(',') for fn in os.listdir(d) if fn.endswith('.glb') and '_' in fn and fn[:-4].replace('-', '').replace('_', '').isdigit()})
        mask = {int(k.split('_')[0]) * 100000 + int(k.split('_')[1]) for k in cells}
        drawn = sorted({k for f in LS['frames'] for k in f['chunks']})
        os.makedirs(a.dst, exist_ok=True)
        rep = {'chunks': drawn, 'cells_masked': cells, 'landmarks': [], 'landmarks_inside': [], 'tris': {}}
        idx = json.load(open('/data0/projectnyc_aux/cellcache/plain/lod16/index.json'))
        for k in drawn:
            rep['tris'][k] = prep(os.path.join(a.src, f'{k}.glb'), os.path.join(a.dst, f'{k}.glb'), mask)
        for k in LS['union']['landmarks']:
            e_ = idx['landmarks'].get(k) or {}
            b = e_.get('bounds')
            # ==== R2B: a bridge is long: its centre in the cells' region does not mean the cells hold all of it (the Hell
            # Gate's east half and Queens tower lay beyond the grid of the RFK probe and went missing); a bridge's
            # silhouette is masked under the cells triangle by triangle like a chunk, the rest of it kept
            if e_.get('kind') == 'bridge' or e_.get('drawnBy') == 'bridgeKit':
                rep['tris'][f'LM_{k}'] = prep(os.path.join(a.src, f'LM_{k}.glb'), os.path.join(a.dst, f'LM_{k}.glb'), mask); rep['landmarks'].append(k)
                continue
            # ==== end R2B
            if b and (math.floor((b[0] + b[3]) / 2 / 128.0) * 100000 + math.floor((b[2] + b[5]) / 2 / 128.0)) in mask:
                rep['landmarks_inside'].append(k); continue
            rep['tris'][f'LM_{k}'] = prep(os.path.join(a.src, f'LM_{k}.glb'), os.path.join(a.dst, f'LM_{k}.glb'), None); rep['landmarks'].append(k)
        # ==== R2B: the persistent parts of the L6 packages the load set does not draw (finer levels draw their shells): their
        # ground, masked under the cells as a drawn chunk's is, and their water (under the L5 and L4 chunks there was no
        # ground at all: the shells stood over the sky's planet surface)
        rep['water_only'] = []
        if a.water_src and os.path.isdir(a.water_src):
            for fn in sorted(os.listdir(a.water_src)):
                if not fn.endswith('.glb'): continue
                r_ = prep(os.path.join(a.water_src, fn), os.path.join(a.dst, f'W_{fn}'), mask, only={'ground', 'water'})
                if r_: rep['tris'][f'W_{fn[:-4]}'] = r_; rep['water_only'].append(fn[:-4])
        wt = sum(v.get('water_tris', 0) for v in rep['tris'].values())
        # ==== end R2B
        json.dump(rep, open(os.path.join(a.dst, 'lodprep.json'), 'w'), indent=1)
        tin = sum(v['tris_in'] for v in rep['tris'].values()); tout = sum(v['tris_out'] for v in rep['tris'].values())
        print(json.dumps({'chunks': len(drawn), 'landmarks': len(rep['landmarks']), 'inside': rep['landmarks_inside'], 'cells_masked': len(cells), 'tris_in': tin, 'tris_out': tout,
                          'water_only': len(rep['water_only']), 'water_tris': wt}))
        return
    rect = [float(v) for v in a.region.split(',')]
    idx = json.load(open(os.path.join(a.src, 'index.json')))
    os.makedirs(a.dst, exist_ok=True)
    ch = idx['chunks']
    over = [k for k in idx['persistent'] if (lambda b: b[0] < rect[2] and b[3] > rect[0] and b[2] < rect[3] and b[5] > rect[1])(ch[k]['bounds'])]
    take = [k for k in idx['persistent'] if k not in over]
    l5 = []
    if a.l5 == 'auto':
        for k in over:
            _, i, j = k.split('_'); i, j = int(i), int(j)
            kids = [f'L5_{2 * i + di}_{2 * j + dj}' for di in (0, 1) for dj in (0, 1)]
            have = [c for c in kids if c in ch]
            l5 += have
            if len(have) < len([c for c in kids]):   # (children missing (empty water chunks are not written): the parent stays out only if every one exists)
                pass
    else:
        take += over
    rep = {'l6': take, 'l6_replaced': over, 'l5': l5, 'landmarks': [], 'landmarks_inside': [], 'tris': {}}
    for k in take + l5:
        rep['tris'][k] = prep(os.path.join(a.src, ch[k]['file']), os.path.join(a.dst, f'{k}.glb'), rect)
    for k, lm in idx['landmarks'].items():
        b = lm.get('bounds')
        cx, cz = ((b[0] + b[3]) / 2, (b[2] + b[5]) / 2) if b else (None, None)
        if b and rect[0] < cx < rect[2] and rect[1] < cz < rect[3]:
            rep['landmarks_inside'].append(k); continue
        rep['tris'][f'LM_{k}'] = prep(os.path.join(a.src, lm['file']), os.path.join(a.dst, f'LM_{k}.glb'), None)
        rep['landmarks'].append(k)
    rep['fw14'] = os.path.join(os.path.dirname(os.path.dirname(a.src)), idx['textures']['fw14'])
    json.dump(rep, open(os.path.join(a.dst, 'lodprep.json'), 'w'), indent=1)
    tin = sum(v['tris_in'] for v in rep['tris'].values()); tout = sum(v['tris_out'] for v in rep['tris'].values())
    print(json.dumps({'l6': len(take), 'l6_replaced': over, 'l5': l5, 'landmarks': len(rep['landmarks']), 'inside': rep['landmarks_inside'], 'tris_in': tin, 'tris_out': tout, 'fw14': rep['fw14']}))


if __name__ == '__main__':
    main()
