#!/usr/bin/env python3
"""Streaming and shimmer scan of a rendered clip (stream06, 2026-10-26).

    python3 tools/qa/stream_scan.py <clip dir> [--frames a-b] [--out <dir>] [--json <file>] [--max-drawin N] [--max-shimmer P]

Reads the clip's frames and its _depth folder (planar depth and the take's cameras, written by ue_frames.py) and reprojects
pixels between frames through their own depth, so the lens's motion and parallax cancel:

- draw-in: every pixel of frame t+K (--k 12) reprojected into frame t; geometry there that frame t saw through (t's depth,
  a 3x3 minimum, over --grow (3) times farther, points nearer than --min-m 200 m left out: foliage and approach detail)
  was missing in t. The same test the other way (in t, gone in t+K) is subtracted per 80 px tile, so thin cables and
  glass that alias in and out cancel and geometry that arrives and stays remains. A tile is a draw-in when it grows in
  at least --min-frames frames (mnFdrSchurz, render_c2, 2026-10-26: towers drawn as window grids and floating roof
  slabs that filled in as the lens neared, 703 px a frame; clean shots 0-285);
- far shimmer: pixels farther than --far-m (and not sky) that differ from both reprojected neighbours the same way while
  those agree (reproj12.py's flicker test), as a share of the far pixels per frame and per tile (pLibGold, ue13: Lower
  Manhattan's facades switching colour frame to frame, 3 tiles over 1 %; clean shots 0 or 1).

Exit 1 when the draw-in pixels a frame or the far shimmer exceed their maximum (the shot's QA fails), else 0.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('clip'); ap.add_argument('--frames', default=None); ap.add_argument('--out', default=None); ap.add_argument('--json', default=None)
ap.add_argument('--scale', type=int, default=2, help='work at 1/scale resolution')
ap.add_argument('--min-m', type=float, default=200.0, help='draw-in: points nearer than this are not tested (foliage, approach LOD)')
ap.add_argument('--grow', type=float, default=3.0, help='draw-in: frame t\'s depth over this times the point\'s = not drawn in t')
ap.add_argument('--far-m', type=float, default=1500.0); ap.add_argument('--sky-m', type=float, default=60000.0)
ap.add_argument('--th', type=float, default=14.0, help='flicker luminance step (of 255)')
ap.add_argument('--tile', type=int, default=80, help='tile size in full-frame pixels')
ap.add_argument('--min-px', type=int, default=24, help='draw-in pixels (full res) in a tile for it to count in a frame')
ap.add_argument('--min-frames', type=int, default=4, help='frames a tile must grow in to be a draw-in')
ap.add_argument('--max-drawin', type=float, default=400.0, help='fail above this many draw-in pixels a frame (full res, in draw-in tiles, mean over the scanned frames)')
ap.add_argument('--max-shimmer', type=float, default=0.25, help='fail above this mean % of far pixels flickering a frame')
ap.add_argument('--max-shimmer-tiles', type=int, default=1, help='fail when more tiles than this shimmer (over 1 %% of their far pixels flickering over the shot)')
ap.add_argument('--step', type=int, default=1)
ap.add_argument('--k', type=int, default=12, help='draw-in: compare frame t with t+k')
ap.add_argument('--jobs', type=int, default=16)
a = ap.parse_args()

DD = os.path.join(a.clip, '_depth')
CAMS = json.load(open(os.path.join(DD, 'cams.json')))
W, H = CAMS['res']; S = a.scale
have = sorted(int(f) for f in CAMS['frames'] if os.path.exists(os.path.join(DD, 'depth_%04d.png' % int(f))) and os.path.exists(os.path.join(a.clip, 'frame_%05d.jpg' % int(f))))
if a.frames: fa, fb = map(int, a.frames.split('-')); have = [f for f in have if fa <= f < fb]
if len(have) < 3: print('stream_scan: fewer than 3 frames with depth'); sys.exit(0)
hs, ws = H // S, W // S
ys, xs = np.mgrid[0:hs, 0:ws].astype(np.float64)
U = (xs * S + S / 2) / W; V = (ys * S + S / 2) / H


def load(f):
    im = np.asarray(Image.open(os.path.join(a.clip, 'frame_%05d.jpg' % f)).convert('L').resize((ws, hs), Image.BILINEAR), np.float32)
    d = np.asarray(Image.open(os.path.join(DD, 'depth_%04d.png' % f)), np.float64)[S // 2::S, S // 2::S][:hs, :ws]
    return im, 2.0 ** (d / 65535.0 * 18.0 - 2.0)


def cam(f):
    C = CAMS['frames'][str(f)]; return np.array(C['m'], np.float64), np.array(C['vf'], np.float64)


def warp(t, n, dt):
    """frame t's pixels (depth dt) projected into frame n: the sampling coordinates in n's half-res image and the depth there"""
    M, vf = cam(t); X = vf[3][0] + U * (vf[0][0] - vf[3][0]); Y = vf[3][1] + V * (vf[2][1] - vf[3][1]); Z = vf[0][2]
    k = dt / abs(Z)
    P = np.stack([X * k, Y * k, Z * k], -1) @ M[:3, :3].T + M[:3, 3]
    Mn, vn = cam(n); R = Mn[:3, :3]
    Q = (P - Mn[:3, 3]) @ R          # (R orthonormal: the inverse rotation)
    zn = -Q[..., 2]; zs = np.maximum(zn, 1e-6) / abs(vn[0][2])
    un = (Q[..., 0] / zs - vn[3][0]) / (vn[0][0] - vn[3][0]); vv = (Q[..., 1] / zs - vn[3][1]) / (vn[2][1] - vn[3][1])
    px = un * W / S - 0.5; py = vv * H / S - 0.5
    ok = (zn > 0.5) & (px >= 2) & (px < ws - 3) & (py >= 2) & (py < hs - 3)
    return px, py, zn, ok


def sample(img, px, py, ok, nearest=False):
    xi = np.clip(np.rint(px).astype(int) if nearest else np.floor(px).astype(int), 0, ws - 2); yi = np.clip(np.rint(py).astype(int) if nearest else np.floor(py).astype(int), 0, hs - 2)
    if nearest: return img[yi, xi]
    fx = np.clip(px - xi, 0, 1); fy = np.clip(py - yi, 0, 1)
    return (img[yi, xi] * (1 - fx) * (1 - fy) + img[yi, xi + 1] * fx * (1 - fy) + img[yi + 1, xi] * (1 - fx) * fy + img[yi + 1, xi + 1] * fx * fy)


def minfilt(d):
    p = np.pad(d, 1, mode='edge'); out = d.copy()
    for dy in (0, 1, 2):
        for dx in (0, 1, 2): out = np.minimum(out, p[dy:dy + hs, dx:dx + ws])
    return out


def score(i):
    t = have[i]; tp = have[i - 1]; tn = have[i + 1]
    imt, dt = load(t); imp, dp = load(tp); imn, dn = load(tn)
    geo = dt < a.sky_m
    px, py, zn, okp = warp(t, tp, dt)
    T = a.tile // S; ty, tx = hs // T, ws // T
    def tiles(m): return m[:ty * T, :tx * T].reshape(ty, T, tx, T).sum((1, 3))
    # draw-in against frame t+K: geometry of t+K whose point frame t saw through (t's depth there, 3x3 minimum, farther by
    # over --grow) is missing in t; the same test the other way (in t, missing in t+K) is subtracted per tile, so thin
    # cables and window glass that alias in and out cancel and geometry that arrives and stays remains
    tk = have[min(i + a.k, len(have) - 1)]; imk, dk = load(tk); geok = dk < a.sky_m
    # (and the picture must change there too: a surface drawn without depth, a translucent facade over the sky, keeps its
    # colour and is not a draw-in (mnHrdHighbridge's towers, 2026-10-26: 85 % of their wall pixels at the sky's depth))
    ax, ay, az, oka = warp(tk, t, dk)
    miss_t = oka & geok & (az > a.min_m) & (sample(minfilt(dt), ax, ay, oka, nearest=True) > a.grow * az) & (np.abs(imk - sample(imt, ax, ay, oka)) > a.th)
    bx, by, bz, okb = warp(t, tk, dt)
    miss_k = okb & geo & (bz > a.min_m) & (sample(minfilt(dk), bx, by, okb, nearest=True) > a.grow * bz) & (np.abs(imt - sample(imk, bx, by, okb)) > a.th)
    TA = np.zeros((ty, tx)); iy = np.clip((ay[miss_t] // T).astype(int), 0, ty - 1); ix = np.clip((ax[miss_t] // T).astype(int), 0, tx - 1)
    np.add.at(TA, (iy, ix), 1)
    tdraw = np.maximum(TA - tiles(miss_k), 0)
    drawin = np.zeros((hs, ws), bool)
    yy, xx = np.clip(np.rint(ay[miss_t]).astype(int), 0, hs - 1), np.clip(np.rint(ax[miss_t]).astype(int), 0, ws - 1); drawin[yy, xx] = True
    drawin &= ~miss_k
    # far shimmer (reproj12's test, restricted to far, non-sky pixels)
    cp = sample(imp, px, py, okp); dpz = sample(dp, px, py, okp, nearest=True); okp2 = okp & (np.abs(dpz - zn) < 0.03 * zn)
    qx, qy, zq, okn = warp(t, tn, dt); cn = sample(imn, qx, qy, okn); dnz = sample(dn, qx, qy, okn, nearest=True); okn2 = okn & (np.abs(dnz - zq) < 0.03 * zq)
    far = geo & (dt > a.far_m) & okp2 & okn2
    d1, d2 = imt - cp, imt - cn
    fl = far & (np.sign(d1) == np.sign(d2)) & (np.abs(cp - cn) < a.th * 0.5) & (np.minimum(np.abs(d1), np.abs(d2)) > a.th)
    return t, tdraw, tiles(fl), tiles(far), int(far.sum()), drawin, fl


if __name__ == '__main__':
    from multiprocessing import Pool
    idx = list(range(1, len(have) - 2, a.step))
    rows, dmaps, fmaps = [], {}, {}
    with Pool(a.jobs) as P:
        for t, td, tf, tfar, nfar, dm, fm in P.imap(score, idx, chunksize=2):
            rows.append((t, td, tf, tfar, nfar)); dmaps[t] = dm; fmaps[t] = fm
    rows.sort(key=lambda r: r[0])
    s2 = S * S; minpx = a.min_px / s2
    TD = np.stack([r[1] for r in rows]); TF = np.stack([r[2] for r in rows]); TFAR = np.stack([r[3] for r in rows])
    grows = TD >= minpx                                        # (frames x tiles: the tile grew in that frame)
    nfr = grows.sum(0); hot = nfr >= a.min_frames               # (draw-in tiles)
    drawin_pf = (TD * hot[None]).sum((1, 2)) * s2              # (full-res draw-in px per frame, in draw-in tiles)
    shim_pf = TF.sum((1, 2)) / np.maximum(TFAR.sum((1, 2)), 1) * 100
    farshare = float(TFAR.sum() / max(1, TFAR.size * (a.tile // S) ** 2))
    tilesout = []
    for (yy, xx) in zip(*np.nonzero(hot)):
        fr = [rows[k][0] for k in np.nonzero(grows[:, yy, xx])[0]]
        tilesout.append({'tile': [int(xx * a.tile), int(yy * a.tile), a.tile, a.tile], 'frames': len(fr), 'first': fr[0], 'last': fr[-1], 'px': int(TD[:, yy, xx].sum() * s2)})
    tilesout.sort(key=lambda d: -d['px'])
    shim_tiles = TF.sum(0) / np.maximum(TFAR.sum(0), 1) * 100
    st = [{'tile': [int(xx * a.tile), int(yy * a.tile), a.tile, a.tile], 'pct': round(float(shim_tiles[yy, xx]), 2)} for yy, xx in zip(*np.nonzero((shim_tiles > 1.0) & (TFAR.sum(0) > TFAR.shape[0] * 50)))]
    st.sort(key=lambda d: -d['pct'])
    res = {'clip': a.clip, 'frames': [rows[0][0], rows[-1][0]], 'scanned': len(rows),
           'drawin_px_per_frame': round(float(drawin_pf.mean()), 1), 'drawin_worst': [int(rows[int(drawin_pf.argmax())][0]), int(drawin_pf.max())],
           'drawin_tiles': len(tilesout), 'drawin_top': tilesout[:12],
           'far_shimmer_pct': round(float(shim_pf.mean()), 3), 'far_shimmer_worst': [int(rows[int(shim_pf.argmax())][0]), round(float(shim_pf.max()), 3)],
           'far_share': round(farshare, 3), 'shimmer_tiles': st[:12],
           'per_frame': [[int(r[0]), int(d), round(float(s), 3)] for r, d, s in zip(rows, drawin_pf, shim_pf)],
           'max_drawin': a.max_drawin, 'max_shimmer': a.max_shimmer}
    fails = []
    if res['drawin_px_per_frame'] > a.max_drawin: fails.append(f"draw-in {res['drawin_px_per_frame']} px/frame over {a.max_drawin} ({len(tilesout)} tiles, worst frame {res['drawin_worst'][0]})")
    if res['far_shimmer_pct'] > a.max_shimmer: fails.append(f"far shimmer {res['far_shimmer_pct']} % of far pixels over {a.max_shimmer} (worst frame {res['far_shimmer_worst'][0]})")
    if len(st) > a.max_shimmer_tiles: fails.append(f"far shimmer concentrated in {len(st)} tiles over 1 % (max {a.max_shimmer_tiles}; worst {st[0]['tile'][:2]} {st[0]['pct']} %)")
    res['fail'] = fails
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        # (maps: draw-in summed over the shot in red, far shimmer in cyan, over the worst draw-in frame)
        wf = res['drawin_worst'][0] if tilesout else res['far_shimmer_worst'][0]
        base = np.asarray(Image.open(os.path.join(a.clip, 'frame_%05d.jpg' % wf)).convert('RGB').resize((ws, hs)), np.float32) * 0.6
        dsum = np.zeros((hs, ws), np.float32); fsum = np.zeros((hs, ws), np.float32)
        for t in dmaps: dsum += dmaps[t]; fsum += fmaps[t]
        base[..., 0] += np.clip(dsum * 60, 0, 255) * 0.8; base[..., 1] += np.clip(fsum * 40, 0, 255) * 0.5; base[..., 2] += np.clip(fsum * 40, 0, 255) * 0.8
        Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(os.path.join(a.out, 'stream_map.jpg'), quality=90)
        if tilesout:   # (a strip of the worst draw-in tile's neighbourhood across its frames)
            x0, y0 = tilesout[0]['tile'][:2]; cx, cy = x0 + a.tile // 2, y0 + a.tile // 2
            bx0 = int(np.clip(cx - 240, 0, W - 480)); by0 = int(np.clip(cy - 160, 0, H - 320))
            fr = np.linspace(max(have[0], tilesout[0]['first'] - 2), min(have[-1], tilesout[0]['last'] + 2), 6).astype(int)
            strip = Image.new('RGB', (480 * 6, 320))
            for k, f in enumerate(fr): strip.paste(Image.open(os.path.join(a.clip, 'frame_%05d.jpg' % f)).crop((bx0, by0, bx0 + 480, by0 + 320)), (480 * k, 0))
            strip.save(os.path.join(a.out, 'drawin_strip.jpg'), quality=90); res['drawin_strip'] = {'box': [bx0, by0, 480, 320], 'frames': [int(f) for f in fr]}
    if a.json: json.dump(res, open(a.json, 'w'), indent=1)
    print(f"stream_scan {os.path.basename(a.clip.rstrip('/'))}: {len(rows)} frames; draw-in {res['drawin_px_per_frame']} px/frame in {len(tilesout)} tiles (worst f{res['drawin_worst'][0]} {res['drawin_worst'][1]}); "
          f"far shimmer {res['far_shimmer_pct']} % (worst f{res['far_shimmer_worst'][0]} {res['far_shimmer_worst'][1]}) over {res['far_share']*100:.0f} % far pixels" + (' -> FAIL: ' + '; '.join(fails) if fails else ' -> ok'))
    sys.exit(1 if fails else 0)
