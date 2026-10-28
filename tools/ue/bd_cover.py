#!/usr/bin/env python3
# NJCOVER (2026-10-24): the backdrop's land cover at 1-6 km, for the far shore Manhattan's shots look at (the Palisades,
# Edgewater, Fort Lee, Yonkers): on every L3/L4 backdrop package inside the canopy raster,
#  - tree crowns (6-sided domes, 18 triangles) where the USFS/MRLC NLCD 2021 Tree Canopy Cover (public domain, 30 m)
#    says there are trees, one candidate per jittered grid square kept with the cover's share, never on a building's
#    footprint, a steep face, water or a paved texel of the chunk's own ground map; appended to the chunk's bdShells
#    (the backdrop shell master: tint from the vertex colour, no windows where TEXCOORD_0 is constant), so they cost no
#    new material and no new Nanite mesh;
#  - the woods' canopy surface (the old smooth shell over natural=wood, shades 0.92/0.65) dropped from bdGround: the
#    crowns stand there instead;
#  - the ground map darkened under the canopy (the floor between crowns in shade) and steep ground painted as diabase
#    from ambientCG Rock030 (CC0), tiled, darkened (the master's own steep-rock term takes the faces past ~50 degrees).
# Called by r1c_lodprep.prep on its output when UE_FAR_COVER is set; idempotent per source (prep rewrites the file).
import io, json, math, os, struct, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TCC = os.environ.get('UE_FAR_COVER_TCC', '/data0/projectnyc_aux/data/canopy/tcc2021_nj.tif')
ROCK = os.environ.get('UE_FAR_COVER_ROCK', '/data0/projectnyc_aux/data/rock_cc0/Rock030/Rock030_1K-JPG_Color.jpg')
LAT0, LON0 = 40.7831, -73.9712   # (client/tools/pipeline/backdrop/common.py's projection)
MLAT = 111132.0; MLON = 111320.0 * math.cos(math.radians(LAT0))
# level: (grid m, crown radius m range, tree height m range)
# (pass 2: fewer, larger crowns; the radius grows with the cover so that over ~60 % neighbours touch into a closed roof)
LV = {3: (9.0, (0.42, 0.78), (13.0, 24.0)), 4: (14.0, (0.42, 0.78), (14.0, 25.0))}   # (radius as a share of the grid)
# (summer deciduous, the near Inwood woods' yellow-green: oak, maple, tulip tree, a darker birch/beech share)
FOLIAGE = np.array([(0.066, 0.104, 0.028), (0.080, 0.118, 0.032), (0.056, 0.090, 0.030), (0.092, 0.124, 0.036), (0.060, 0.096, 0.040), (0.050, 0.078, 0.026)], np.float32)
_T = {}
VERSION = 2   # (the far library's record: a new version prepares the covered packages again; 2 = NJSHORE lawns)


def tcc():
    if 'tcc' not in _T:
        import tifffile
        t = tifffile.TiffFile(TCC); a = t.pages[0].asarray().astype(np.float32)
        M = t.pages[0].tags['ModelTransformationTag'].value
        a[a > 100] = 0
        _T['tcc'] = (a, M[0], M[3], M[5], M[7])
    return _T['tcc']


def tcc_at(x, z):
    a, dlon, lon0, dlat, lat0 = tcc()
    lon = x / MLON + LON0; lat = -z / MLAT + LAT0
    fi = (lon - lon0) / dlon - 0.5; fj = (lat - lat0) / dlat - 0.5
    i0 = np.floor(fi).astype(np.int64); j0 = np.floor(fj).astype(np.int64); u = fi - i0; v = fj - j0
    H, W = a.shape; inside = (i0 >= 0) & (j0 >= 0) & (i0 < W - 1) & (j0 < H - 1)
    i0 = np.clip(i0, 0, W - 2); j0 = np.clip(j0, 0, H - 2)
    r = (a[j0, i0] * (1 - u) * (1 - v) + a[j0, i0 + 1] * u * (1 - v) + a[j0 + 1, i0] * (1 - u) * v + a[j0 + 1, i0 + 1] * u * v) / 100.0
    return np.where(inside, r, -1.0)


def covered(b):   # (the package's box inside the raster)
    a, dlon, lon0, dlat, lat0 = tcc()
    lo = lambda x: x / MLON + LON0; la = lambda z: -z / MLAT + LAT0
    return lon0 < lo(b[0]) and lo(b[1]) < lon0 + dlon * a.shape[1] and lat0 + dlat * a.shape[0] < la(b[3]) and la(b[2]) < lat0


def rock():
    if 'rock' not in _T:
        from PIL import Image
        r = np.asarray(Image.open(ROCK).convert('RGB').resize((256, 256)), np.float32) / 255.0
        g = r.mean(2, keepdims=True)
        # (diabase: dark grey with a brown cast; the photo's contrast kept)
        _T['rock'] = np.clip((g - g.mean()) * 1.1 + 0.19, 0, 1) * np.array([1.0, 0.96, 0.90], np.float32)   # (diabase: grey-brown, dark)
    return _T['rock']


def apply(path):
    sys.path.insert(0, HERE)
    from r1c_lodprep import read
    from PIL import Image
    f = open(path, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + L]); o = 20 + L
    B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
    root = J['nodes'][J['scenes'][0]['nodes'][0]]
    org = np.asarray(root.get('translation') or [0, 0, 0], np.float64)
    gnode = snode = None
    for i in root.get('children') or []:
        n = J['nodes'][i]; ex = n.get('extras') or {}
        if not ex.get('backdrop') or 'mesh' not in n: continue
        if n.get('name') == 'bdGround': gnode = n
        elif n.get('name') == 'bdShells': snode = n
    if gnode is None: return None
    lv = int((gnode.get('extras') or {}).get('level') or 0)
    if lv not in LV: return None
    gp = J['meshes'][gnode['mesh']]['primitives'][0]
    P = read(J, B, gp['attributes']['POSITION']); UV = read(J, B, gp['attributes']['TEXCOORD_0'])
    SH = read(J, B, gp['attributes']['COLOR_0'])[:, 0]; I = read(J, B, gp['indices'], raw=True).reshape(-1, 3).astype(np.int64)
    wb = [P[:, 0].min() + org[0], P[:, 0].max() + org[0], P[:, 2].min() + org[2], P[:, 2].max() + org[2]]
    if not covered(wb): return None
    st = {'level': lv}
    # ---- the canopy surface out
    cs = (SH > 0.6) & (SH < 0.95)
    can = cs[I].all(1)
    st['canopy_tris_dropped'] = int(can.sum())
    gnd_t = I[~can & (SH[I] > 0.97).all(1)]
    # ---- the ground map and its texel grid (uv linear in x, z)
    tex_i = J['materials'][gp['material']]['pbrMetallicRoughness']['baseColorTexture']['index']
    img_i = J['textures'][tex_i]['source']; bv = J['bufferViews'][J['images'][img_i]['bufferView']]
    im = np.asarray(Image.open(io.BytesIO(B[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB'), np.float32) / 255.0
    Hh, Ww = im.shape[:2]
    au = np.polyfit(P[:, 0], UV[:, 0], 1); av = np.polyfit(P[:, 2], UV[:, 1], 1)
    # texel (c, r) centre -> local x, z
    tx = ((np.arange(Ww) + 0.5) / Ww - au[1]) / au[0]; tz = ((np.arange(Hh) + 0.5) / Hh - av[1]) / av[0]
    hgt = np.full((Hh, Ww), np.nan, np.float32); ny = np.ones((Hh, Ww), np.float32)
    px = (P[:, 0] * au[0] + au[1]) * Ww - 0.5; pz = (P[:, 2] * av[0] + av[1]) * Hh - 0.5
    for t in gnd_t:
        a_, b_, c_ = t
        x0, x1 = int(math.floor(min(px[t]))), int(math.ceil(max(px[t]))); z0, z1 = int(math.floor(min(pz[t]))), int(math.ceil(max(pz[t])))
        x0 = max(x0, 0); z0 = max(z0, 0); x1 = min(x1, Ww - 1); z1 = min(z1, Hh - 1)
        if x1 < x0 or z1 < z0: continue
        X, Z = np.meshgrid(np.arange(x0, x1 + 1), np.arange(z0, z1 + 1))
        d = (pz[b_] - pz[c_]) * (px[a_] - px[c_]) + (px[c_] - px[b_]) * (pz[a_] - pz[c_])
        if abs(d) < 1e-9: continue
        l1 = ((pz[b_] - pz[c_]) * (X - px[c_]) + (px[c_] - px[b_]) * (Z - pz[c_])) / d
        l2 = ((pz[c_] - pz[a_]) * (X - px[c_]) + (px[a_] - px[c_]) * (Z - pz[c_])) / d
        l3 = 1 - l1 - l2; m = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not m.any(): continue
        hgt[Z[m], X[m]] = l1[m] * P[a_, 1] + l2[m] * P[b_, 1] + l3[m] * P[c_, 1]
        nrm = np.cross(P[b_] - P[a_], P[c_] - P[a_]); nrm /= (np.linalg.norm(nrm) + 1e-12)
        ny[Z[m], X[m]] = abs(nrm[1])
    land = ~np.isnan(hgt)
    WX, WZ = np.meshgrid(tx + org[0], tz + org[2])
    T = tcc_at(WX, WZ); T = np.where(T < 0, 0, T)
    # ---- buildings' footprints (shell triangles' x, z), 3 m round them
    bmask = np.zeros((Hh, Ww), bool)
    if snode is not None:
        sp = J['meshes'][snode['mesh']]['primitives'][0]
        SP = read(J, B, sp['attributes']['POSITION'])
        ci = np.clip(((SP[:, 0] * au[0] + au[1]) * Ww).astype(np.int64), 0, Ww - 1); ri = np.clip(((SP[:, 2] * av[0] + av[1]) * Hh).astype(np.int64), 0, Hh - 1)
        SI = read(J, B, sp['indices'], raw=True).reshape(-1, 3).astype(np.int64)
        from PIL import ImageDraw
        mimg = Image.new('L', (Ww, Hh), 0); dr = ImageDraw.Draw(mimg)
        for t in SI: dr.polygon([(int(ci[k]), int(ri[k])) for k in t], fill=255)
        from scipy.ndimage import binary_dilation
        texm = abs(1.0 / (au[0] * Ww))   # (m per texel)
        bmask = binary_dilation(np.asarray(mimg) > 0, iterations=max(1, int(round(3.0 / texm))))
    # ---- paved / built texels of the ground map: low saturation, not green
    sat = im.max(2) - im.min(2); green = (im[..., 1] > im[..., 0] + 0.015) & (im[..., 1] > im[..., 2] + 0.015)
    paved = (~green) & (sat < 0.10)
    # ---- the ground map: the floor under canopy darker and greener, steep ground diabase
    out = im.copy()
    k = np.clip(T, 0, 1)[..., None] * land[..., None] * (~paved)[..., None]
    # (pass 3: the floor between crowns a dark canopy green, so a gap reads as more forest, not a hole)
    floor = np.array([0.15, 0.22, 0.08], np.float32)
    kk = np.clip(k * 1.3, 0, 1)
    out = out * (1 - 0.8 * kk) + floor * 0.8 * kk * (0.85 + 0.3 * out.mean(2, keepdims=True))
    # (NJSHORE 2026-10-26: open lawns, the map's light OSM grass (Ross Dock's picnic lawn read as a pale plate on the shore
    # from across the river), toned to the cover's summer grass: darker, less yellow, broken by a soft noise; trees' floor kept)
    from scipy.ndimage import gaussian_filter as _gf
    gness = np.clip((im[..., 1] - np.maximum(im[..., 0], im[..., 2])) / 0.06, 0, 1) * land * (~paved)
    lawn = (gness * np.clip(1.0 - 1.6 * T, 0, 1))[..., None]
    ln = _gf(np.random.default_rng(11).uniform(0, 1, (Hh, Ww)), 2.0); ln = ((ln - ln.mean()) / (ln.std() + 1e-9))[..., None]
    grass = np.array([0.19, 0.25, 0.10], np.float32) * (0.85 + 0.3 * np.clip(im.mean(2, keepdims=True) / max(float(im.mean()), 1e-3) - 0.5, 0, 1) + 0.08 * ln)
    out = out * (1 - 0.8 * lawn) + grass * 0.8 * lawn
    st['lawn_texels'] = int((lawn[..., 0] > 0.5).sum())
    R = rock(); texm = abs(1.0 / (au[0] * Ww))
    rr = ((WZ / 20.0 * 256).astype(np.int64)) % 256; rc = ((WX / 20.0 * 256).astype(np.int64)) % 256
    # (columns: the Palisades' joints are vertical, so seen from the river a column is a line down the slope: bands across
    # the contour, a hashed shade per 2.5 m band along it)
    from scipy.ndimage import gaussian_filter
    hf = gaussian_filter(np.where(land, hgt, np.nanmean(hgt) if land.any() else 0).astype(np.float64), 2.0)
    gz_, gx_ = np.gradient(hf); gl = np.hypot(gx_, gz_) + 1e-9
    along = (WX * (-gz_ / gl) + WZ * (gx_ / gl))
    band = np.floor(along / 2.5); hb = np.modf(np.sin(band * 12.9898 + 78.233) * 43758.5453)[0]
    colm = (0.72 + 0.5 * np.abs(hb))[..., None]
    rk = R[rr, rc] * colm
    # (a soft edge into the canopy: the slope weight blurred and broken by a noise field)
    w0 = np.clip((0.84 - ny) / (0.84 - 0.66), 0, 1) * land
    nz = gaussian_filter(np.random.default_rng(7).uniform(0, 1, w0.shape), 3.0); nz = (nz - nz.mean()) / (nz.std() + 1e-9)
    w = np.clip(gaussian_filter(w0, 3.0 / max(texm, 0.5)) * 1.25 + 0.18 * nz - 0.12, 0, 1)[..., None] * land[..., None]
    out = out * (1 - w) + rk * w
    st['rock_texels'] = int((w[..., 0] > 0.5).sum())
    from PIL import Image as _I
    buf = io.BytesIO(); _I.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(buf, 'JPEG', quality=90)
    newimg = buf.getvalue()
    # ---- crowns
    gs, (r0, r1), (h0, h1) = LV[lv]
    seed = int(abs(org[0] * 7919 + org[2] * 104729)) % (2 ** 31)
    rng = np.random.default_rng(seed)
    xs = np.arange(P[:, 0].min(), P[:, 0].max(), gs); zs = np.arange(P[:, 2].min(), P[:, 2].max(), gs)
    CX, CZ = np.meshgrid(xs, zs); CX = CX.ravel() + rng.uniform(0, gs, CX.size); CZ = CZ.ravel() + rng.uniform(0, gs, CZ.size)
    ci = ((CX * au[0] + au[1]) * Ww).astype(np.int64); ri = ((CZ * av[0] + av[1]) * Hh).astype(np.int64)
    ok = (ci >= 0) & (ri >= 0) & (ci < Ww) & (ri < Hh)
    CX, CZ, ci, ri = CX[ok], CZ[ok], ci[ok], ri[ok]
    cov = np.clip(tcc_at(CX + org[0], CZ + org[2]), 0, 1)
    pk = np.clip(cov * 1.6, 0, 1) * (1 - 0.6 * w[np.clip(ri, 0, Hh - 1), np.clip(ci, 0, Ww - 1), 0] ** 2)
    pk = np.where(paved[ri, ci], pk * 0.25, pk)
    keep = land[ri, ci] & ~bmask[ri, ci] & (ny[ri, ci] > 0.48) & (rng.uniform(0, 1, CX.size) < pk)
    CX, CZ, ci, ri = CX[keep], CZ[keep], ci[keep], ri[keep]
    n = len(CX); st['crowns'] = n
    newprim = None
    if n:
        GY = hgt[ri, ci].astype(np.float64)
        cv_ = np.clip(tcc_at(CX + org[0], CZ + org[2]), 0, 1)
        r = gs * (r0 + (r1 - r0) * np.clip(cv_ / 0.6, 0, 1)) * rng.uniform(0.82, 1.18, n); h = rng.uniform(h0, h1, n) * (0.85 + 0.3 * np.clip(tcc_at(CX + org[0], CZ + org[2]), 0, 1))
        rot = rng.uniform(0, math.pi / 3, n)
        a6 = rot[:, None] + np.arange(6)[None, :] * (math.pi / 3)
        ca, sa = np.cos(a6), np.sin(a6)
        yb = GY + h * 0.38; y1 = yb + (h * 0.62) * 0.45; yt = GY + h
        V = np.zeros((n, 13, 3)); N = np.zeros((n, 13, 3)); AO = np.zeros((n, 13))
        V[:, 0] = np.stack([CX, yt, CZ], 1); N[:, 0] = (0, 1, 0); AO[:, 0] = 1.0
        V[:, 1:7, 0] = CX[:, None] + ca * r[:, None]; V[:, 1:7, 1] = y1[:, None]; V[:, 1:7, 2] = CZ[:, None] + sa * r[:, None]
        V[:, 7:13, 0] = CX[:, None] + ca * r[:, None] * 0.7; V[:, 7:13, 1] = yb[:, None]; V[:, 7:13, 2] = CZ[:, None] + sa * r[:, None] * 0.7
        for s_, ny_, ao_ in ((slice(1, 7), 0.55, 0.85), (slice(7, 13), -0.25, 0.45)):
            nv = np.stack([ca, np.full_like(ca, ny_), sa], 2); N[:, s_] = nv / np.linalg.norm(nv, axis=2, keepdims=True); AO[:, s_] = ao_
        fi = []
        for j in range(6):
            a1, a2 = 1 + j, 1 + (j + 1) % 6; b1, b2 = 7 + j, 7 + (j + 1) % 6
            fi += [(0, a2, a1), (a1, a2, b2), (a1, b2, b1)]
        fi = np.array(fi, np.int64)
        CI = (fi[None] + (np.arange(n) * 13)[:, None, None]).reshape(-1, 3)
        col = FOLIAGE[rng.integers(0, len(FOLIAGE), n)] * rng.uniform(0.82, 1.18, (n, 1)).astype(np.float32) * rng.uniform(0.93, 1.07, (n, 3)).astype(np.float32)
        COL = np.repeat(col[:, None, :], 13, 1); COL[:, 0] *= 1.12; COL[:, 7:] *= 0.8
        newprim = (V.reshape(-1, 3), N.reshape(-1, 3), COL.reshape(-1, 3), AO.reshape(-1), CI)
    # ---- write: new accessors appended, the ground's indices without the canopy, the map replaced, the crowns in the shells
    extra = bytearray(); base = len(B) + (-len(B)) % 4; pad0 = b'\0' * (base - len(B))

    def add(arr, comp, typ, mm=False):
        data = np.ascontiguousarray(arr).tobytes(); off = base + len(extra)
        J['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
        extra.extend(data + b'\0' * ((-len(data)) % 4))
        acc = {'bufferView': len(J['bufferViews']) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if mm: acc['min'] = arr.min(0).astype(float).tolist(); acc['max'] = arr.max(0).astype(float).tolist()
        J['accessors'].append(acc); return len(J['accessors']) - 1
    mt_ = J['materials'][gp['material']]   # (pass 3: the covered ground on its own duplicate master, bd_cover_mat.py)
    if not mt_.get('name', '').startswith('lod16BdGroundCv'): mt_['name'] = mt_.get('name', 'lod16BdGround').replace('lod16BdGround', 'lod16BdGroundCv', 1)
    if can.any():   # (the kept triangles' vertices alone: Unreal's simplifier asserts on a mesh with unreferenced vertices)
        KI = I[~can]; used = np.unique(KI); remap = np.full(len(P), -1, np.int64); remap[used] = np.arange(len(used))
        for a, i in list(gp['attributes'].items()):
            acc0 = J['accessors'][i]; arr = read(J, B, i, raw=True)[used]
            gp['attributes'][a] = add(arr, acc0['componentType'], acc0['type'], mm=a in ('POSITION', 'TEXCOORD_0'))
            if acc0.get('normalized'): J['accessors'][gp['attributes'][a]]['normalized'] = True
        gp['indices'] = add(remap[KI].astype('<u4').reshape(-1), 5125, 'SCALAR')
    off = base + len(extra); extra.extend(newimg + b'\0' * ((-len(newimg)) % 4))
    J['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(newimg)})
    J['images'][img_i] = {'bufferView': len(J['bufferViews']) - 1, 'mimeType': 'image/jpeg'}
    if newprim is not None:
        V, Nn, COL, AO, CI = newprim
        if snode is None:   # (a chunk of woods without buildings: a shells node of its own, on a shell material)
            mi = len(J['materials']); J['materials'].append({'name': 'lod16Shell#bdcover', 'pbrMetallicRoughness': {'roughnessFactor': 0.9, 'metallicFactor': 0}})
            J['meshes'].append({'name': 'bdShells', 'primitives': [{'attributes': {}, 'material': mi}]})
            J['nodes'].append({'name': 'bdShells', 'mesh': len(J['meshes']) - 1, 'extras': dict(gnode.get('extras') or {}, matKey='lod16Shell#bdcover', **{'class': 2})})
            root.setdefault('children', []).append(len(J['nodes']) - 1); snode = J['nodes'][-1]
            sp = J['meshes'][snode['mesh']]['primitives'][0]
            cur = {'POSITION': np.zeros((0, 3)), 'NORMAL': np.zeros((0, 3)), 'COLOR_0': np.zeros((0, 3)), 'TEXCOORD_0': np.zeros((0, 2)), 'TEXCOORD_1': np.zeros((0, 2))}
            oi = np.zeros(0, np.int64)
        else:
            sp = J['meshes'][snode['mesh']]['primitives'][0]
            cur = {a: read(J, B, i, raw=True) for a, i in sp['attributes'].items()}
            oi = read(J, B, sp['indices'], raw=True).reshape(-1).astype(np.int64)
        nv0 = len(cur['POSITION']); m = len(V)
        fresh = {'POSITION': V, 'NORMAL': Nn, 'COLOR_0': COL, 'TEXCOORD_0': np.zeros((m, 2)), 'TEXCOORD_1': np.stack([np.zeros(m), AO], 1), '_ao': AO[:, None], '_lit': np.zeros((m, 1)), '_bkey': np.zeros((m, 1))}
        for a in list(cur):
            arr = cur[a]; fr = fresh.get(a, np.zeros((m, arr.shape[1]))).astype(arr.dtype).reshape(m, arr.shape[1])
            cat = np.concatenate([arr, fr], 0)
            acc0 = J['accessors'][sp['attributes'][a]] if a in sp['attributes'] else {'componentType': 5126, 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}[arr.shape[1]]}
            cat = cat.astype({5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1', 5122: '<i2', 5120: 'i1'}[acc0['componentType']])   # (a new node's arrays start as float64)
            sp['attributes'][a] = add(cat, acc0['componentType'], acc0['type'], mm=a in ('POSITION', 'TEXCOORD_0', 'TEXCOORD_1'))
            if acc0.get('normalized'): J['accessors'][sp['attributes'][a]]['normalized'] = True
        sp['indices'] = add(np.concatenate([oi, CI.reshape(-1) + nv0]).astype('<u4'), 5125, 'SCALAR')
        ex = snode.setdefault('extras', {}); ex['tris'] = int(ex.get('tris', 0)) + len(CI)
        ex.setdefault('sources', []).append(f'NJCOVER: {n} tree crowns from the NLCD 2021 Tree Canopy Cover (USFS/MRLC, public domain)')
        st['crown_tris'] = int(len(CI))
    NB = B + pad0 + bytes(extra)
    J['buffers'][0]['byteLength'] = len(NB)
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    tmp = path + '.cov.tmp'
    with open(tmp, 'wb') as w:
        w.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(NB)))
        w.write(struct.pack('<II', len(js), 0x4E4F534A)); w.write(js)
        w.write(struct.pack('<II', len(NB), 0x004E4942)); w.write(NB)
    os.replace(tmp, path)
    return st


if __name__ == '__main__':
    for p in sys.argv[1:]: print(p, json.dumps(apply(p)))
