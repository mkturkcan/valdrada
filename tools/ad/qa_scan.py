# Artifact QA for recorded takes (owner 2026-10-01, teaser 4 v3: "water getting weird/switching into something else,
# along with shadows and similar GPU artifacts ... making sure such errors don't happen in teasers").
# Two detectors over each take's frames, on a 320x180 copy in cells of 10x10 px:
#   * a TRANSIENT BLACK BLOCK (the signature of a NaN: the composer's guard paints a non-finite pixel black, and a mirror's
#     or a bloom's mip chain spreads it over a block): two or more adjacent cells near black in one frame that are lit two
#     frames before and two after. Any of these fails the take. BK37 (2026-10-03): only a block shaped, flat and black
#     like a NaN's that did not move with the image (nan_block); dark trunks, foliage and walkers crossing the lens are
#     listed as cleared dark content and do not fail it.
#   * an ISOLATED POP: a cell whose change at frame k is more than twice the largest change it had in the 3 frames either
#     side (smooth camera motion never does that: a mode switch, a LoD or shadow pop, a reflection swap does). Reported
#     with a review strip (frames k-1, k, k+1 of the flagged region) in <out>/<take>_f<k>.jpg; fast near objects passing
#     the lens (benches under the Mall's glide) also trip it, so a human looks at the strips.
#   * QA37 (2026-10-03) the temporal checks of tools/ad/temporal_scan.py on every take: FLICKER (z-fighting, shimmering
#     water), ALTERNATION (a mode toggling frame by frame), STEP / STEPSCAN (shadow, LoD and reflection pops) and the
#     recorder's REFLECTION DROPOUT log; `--notemporal` skips them.
#   python tools/ad/qa_scan.py <clips root> <take[:f0-f1]> ... [--out dir] [--json file] [--notemporal] [--nostream]
# Exit 2 when a take has a transient black block, else 3 when a take fails a temporal check, else 0.
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage

args = [a for a in sys.argv[1:]]
def opt(name, default=None):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
notemporal = '--notemporal' in args
if notemporal: args.remove('--notemporal')
if '--nostream' in args: args.remove('--nostream')
out_dir = opt('--out', None)
json_out = opt('--json', None)
BK37 = opt('--bk37', '1') != '0'   # see nan_block() below
root, takes = args[0], args[1:]
W, H, C = 320, 180, 10
GX, GY = W // C, H // C

def load(d, k):
    p = os.path.join(d, 'frame_%05d.jpg' % k)
    if not os.path.exists(p): return None
    return np.asarray(Image.open(p).convert('RGB').resize((W, H), Image.BILINEAR)).astype(np.float32)

# BK37 (2026-10-03, the explainer's takes): the candidates above also caught dark moving content, a near elm trunk's edge
# (exCpMall: 1-3 px wide at 640x360, 15-27 tall), shore foliage (exCpBow: 2 x 11-15) and a walker's dark edge (t4Crane:
# 20-26 x 1 on 40 frames), none of it non-finite. A block counts only when it is what a NaN leaves (the composer's guard
# paints the pixel black, a mirror's mip chain spreads it over a texel): a filled block at least 4 px on its short side and
# at most 4:1 at 640x360, flat and near black at full size (interior luma mean <= 8, standard deviation <= 2.5: t4Lake's NaN
# blocks of 2026-10-01, cp33/lead34/diag/base, 32 x 72 px at mean 3-4 and deviation 0.6-1.1), and not a dark object that
# moved: no patch of its shape as dark, with its surround as lit, within 64 px in BOTH neighbouring frames (a trunk or a
# walker crossing the lens is there, displaced; a NaN block is not; at the frame's edge, in the frame it came from).
# `--bk37 0` restores the old test.
def nan_block(d, idx, k, big, mask, xs, ys, ev):
    """None when the candidate is a NaN-like block, else why it is not"""
    if not BK37: return None
    w, h = int(xs.max() + 1 - xs.min()), int(ys.max() + 1 - ys.min())
    ev['wh'] = [w, h]
    if min(w, h) < 4 or max(w, h) > 4 * min(w, h): return 'shape %dx%d' % (w, h)
    full = np.asarray(Image.open(os.path.join(d, 'frame_%05d.jpg' % idx[k])).convert('L'), np.float32)
    S = full.shape[1] / 640.0
    big_m = np.kron(mask.astype(np.uint8), np.ones((int(round(S)), int(round(S))), np.uint8)).astype(bool)
    big_m = big_m[:full.shape[0], :full.shape[1]]
    inner = ndimage.binary_erosion(big_m, iterations=max(1, int(S / 2)))
    if inner.sum() < 16: inner = big_m
    v = full[:big_m.shape[0], :big_m.shape[1]][inner]
    ev['mean'] = round(float(v.mean()), 1); ev['std'] = round(float(v.std()), 2)
    if v.mean() > 8 or v.std() > 2.5: return 'textured (mean %.1f, sd %.1f)' % (v.mean(), v.std())
    # moved content: the block's shape as dark (and its 2 px ring as lit, relative to frame k) within 64 px of k-1 and k+1
    ring = ndimage.binary_dilation(mask, iterations=2) & ~mask
    Hh, Ww = big[k].shape
    y0, y1, x0, x1 = max(0, int(ys.min()) - 2), min(Hh, int(ys.max()) + 3), max(0, int(xs.min()) - 2), min(Ww, int(xs.max()) + 3)
    edge = ys.min() <= 1 or xs.min() <= 1 or ys.max() >= Hh - 2 or xs.max() >= Ww - 2   # entering or leaving the frame
    mk, rg = mask[y0:y1, x0:x1], ring[y0:y1, x0:x1]
    if not rg.any(): return None
    din, dout = float(big[k][y0:y1, x0:x1][mk].mean()), float(big[k][y0:y1, x0:x1][rg].mean())
    # 24 px round the block one by one, on to 64 px in steps of 2 (a fast glide moves a storefront 30+ px a frame here:
    # t7StreetGlide f32)
    offs = [o for o in range(-64, 65) if abs(o) <= 24 or o % 2 == 0]
    def found(nb):
        best = None
        for dy in offs:
            for dx in offs:
                a0, b0 = y0 + dy, x0 + dx
                if a0 < 0 or b0 < 0 or a0 + (y1 - y0) > Hh or b0 + (x1 - x0) > Ww: continue
                win = nb[a0:a0 + (y1 - y0), b0:b0 + (x1 - x0)]
                i_, o_ = float(win[mk].mean()), float(win[rg].mean())
                if i_ <= max(12.0, din + 6.0) and o_ - i_ >= 0.5 * (dout - din):
                    return (dy, dx)
        return best
    a, b = found(big[k - 1]), found(big[k + 1])
    # a dark object crossing the lens is in both neighbours, displaced; one at the frame's edge is in the one it came from
    if (a is not None and b is not None) or (edge and (a is not None or b is not None)): return 'moving (k-1 at %s, k+1 at %s)' % (a, b)
    return None

report = {}
fail = False
for t in takes:
    name, rng = (t.split(':') + [None])[:2]
    d = os.path.join(root, name)
    f0, f1 = (int(x) for x in rng.split('-')) if rng else (0, 100000)
    fr, idx = [], []
    for k in range(f0, f1 + 1):
        a = load(d, k)
        if a is None: break
        fr.append(a); idx.append(k)
    if len(fr) < 8:
        report[name] = {'frames': len(fr), 'error': 'too few frames'}; continue
    fr = np.stack(fr); n = len(fr)
    lum = fr @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    cl = lum.reshape(n, GY, C, GX, C).mean(axis=(2, 4))                  # cell luma
    dd = np.abs(fr[1:] - fr[:-1]).mean(axis=3).reshape(n - 1, GY, C, GX, C).mean(axis=(2, 4))
    blocks, pops, dark = [], [], []
    # the black blocks per pixel at 640x360 (a 33 x 71 px block, luma ~4, averages away in the pop cells): near-black now,
    # lit two frames before and two after, in a connected region of 20 px or more (normal frames hold almost no pixel
    # under luma 6: 2 of 3.7 M in t4Lake's frame 43, 2,174 in its NaN frame 44)
    big = []
    for k in range(n):
        p = os.path.join(d, 'frame_%05d.jpg' % idx[k])
        big.append(np.asarray(Image.open(p).convert('L').resize((640, 360), Image.BOX)).astype(np.float32))
    for k in range(2, n - 2):
        m = (big[k] < 8) & (big[k - 2] > 30) & (big[k + 2] > 30)
        if m.sum() < 20: continue
        lab, nl = ndimage.label(m)
        if not nl: continue
        sz = ndimage.sum(np.ones_like(m, np.float32), lab, range(1, nl + 1))
        for j in np.nonzero(sz >= 20)[0]:
            ys, xs = np.nonzero(lab == j + 1)
            # a NaN block is a mip texel: a filled rectangle (t4Lake's: 121-124 px here, 0.86-0.95 of its box); dark hair or
            # a black jacket crossing near the lens is small and ragged (t4Crane / t4Gapstow v4: 28-33 px, 0.70-0.73)
            rect = len(xs) / float((ys.max() + 1 - ys.min()) * (xs.max() + 1 - xs.min()))
            if not ((len(xs) >= 60 and rect >= 0.8) or rect >= 0.9): continue
            ev = {'frame': idx[k], 'cells': int(sz[j]), 'rect': round(rect, 2), 'x': [int(xs.min()) * 4, int(xs.max() + 1) * 4], 'y': [int(ys.min()) * 4, int(ys.max() + 1) * 4]}
            why_not = nan_block(d, idx, k, big, lab == j + 1, xs, ys, ev)
            if why_not: ev['not'] = why_not; dark.append(ev); continue
            blocks.append(ev)
    for k in range(3, n - 4):
        nb = np.concatenate([dd[k - 3:k], dd[k + 1:k + 4]]).max(axis=0)
        hot = (dd[k] > 2.0 * nb) & (dd[k] > 6)
        if hot.sum():
            ys, xs = np.nonzero(hot)
            pops.append({'frame': idx[k + 1], 'cells': int(hot.sum()), 'x': [int(xs.min()) * C * 8, int(xs.max() + 1) * C * 8], 'y': [int(ys.min()) * C * 8, int(ys.max() + 1) * C * 8]})
    report[name] = {'frames': n, 'range': [idx[0], idx[-1]], 'blocks': blocks, 'pops': pops, 'dark': dark}
    if blocks: fail = True
    if out_dir and (blocks or pops):
        os.makedirs(out_dir, exist_ok=True)
        for ev in (blocks + sorted(pops, key=lambda e: -e['cells']))[:8]:
            k = ev['frame']; x0, x1 = ev['x']; y0, y1 = ev['y']
            pad = 120; x0 = max(0, x0 - pad); y0 = max(0, y0 - pad); x1 = min(2560, x1 + pad); y1 = min(1440, y1 + pad)
            ims = []
            for kk in (k - 1, k, k + 1):
                p = os.path.join(d, 'frame_%05d.jpg' % kk)
                if os.path.exists(p): ims.append(Image.open(p).convert('RGB').crop((x0, y0, x1, y1)))
            if not ims: continue
            w, h = ims[0].size; s = 600 / max(w, h)
            strip = Image.new('RGB', (int(w * s) * len(ims) + 8 * (len(ims) - 1), int(h * s)), (255, 0, 0) if ev in blocks else (0, 0, 0))
            for i, im in enumerate(ims): strip.paste(im.resize((int(w * s), int(h * s))), (i * (int(w * s) + 8), 0))
            strip.save(os.path.join(out_dir, '%s_f%03d%s.jpg' % (name, k, '_BLOCK' if ev in blocks else '')), quality=88)
    b, p = report[name]['blocks'], report[name]['pops']
    print('%-14s %4d frames: %s%s; %s' % (name, n, ('TRANSIENT BLACK BLOCKS at frames ' + ', '.join(str(e['frame']) for e in b)) if b else 'no black blocks',
          (' (%d dark-content candidates cleared: %s)' % (len(dark), ', '.join('f%d %s' % (e['frame'], e['not'].split(' (')[0]) for e in dark[:4]))) if dark else '',
          ('%d frames with isolated pops (largest: %s)' % (len(p), ', '.join('f%d %dc' % (e['frame'], e['cells']) for e in sorted(p, key=lambda e: -e['cells'])[:4]))) if p else 'no pops'))
tfail = False
if not notemporal:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import temporal_scan
    for t in takes:
        name, rng = (t.split(':') + [None])[:2]
        f0, f1 = (int(x) for x in rng.split('-')) if rng else (0, 100000)
        rep = temporal_scan.scan(os.path.join(root, name), f0, f1, out_dir, name)
        rep.pop('_arr', None)
        if name in report: report[name]['temporal'] = rep
        tfail |= bool(rep.get('fail'))
        print(temporal_scan.line(rep), flush=True)
# stream06 (2026-10-26): STREAM, tools/qa/stream_scan.py on every take with a _depth folder: progressive draw-in (geometry
# that arrives in place over frames, Nanite pages streaming late: mnFdrSchurz's towers as window grids) and far shimmer
# (far pixels flipping against both reprojected neighbours); `--nostream` skips it. Fails the take as a temporal check.
if '--nostream' not in sys.argv:
    import subprocess
    ss = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'qa', 'stream_scan.py')
    for t in takes:
        name, rng = (t.split(':') + [None])[:2]
        d = os.path.join(root, name)
        if not os.path.exists(os.path.join(d, '_depth', 'cams.json')): continue
        jp = os.path.join(out_dir or d, f'{name}_stream.json')
        if out_dir: os.makedirs(out_dir, exist_ok=True)
        cmd = [sys.executable, ss, d, '--json', jp] + (['--out', os.path.join(out_dir, f'{name}_stream')] if out_dir else []) + (['--frames', rng] if rng else [])
        code = subprocess.call(cmd)
        try: rep = json.load(open(jp)); rep.pop('per_frame', None)
        except Exception: rep = {'error': f'stream_scan exit {code}'}
        if name in report: report[name]['stream'] = rep
        tfail |= code == 1
if json_out:
    with open(json_out, 'w') as fh: json.dump(report, fh, indent=1)
sys.exit(2 if fail else (3 if tfail else 0))
