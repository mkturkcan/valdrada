#!/usr/bin/env python3
# LENS HOLES (2026-11-04, tuValleyTrainDusk: a lens path harvested on 10-13, before the terrain raised the street there,
# ran under the ground for half the shot; the ground's back faces draw nothing, so the cars and walkers stood on the sky):
# per frame of an Unreal take, the share of its steep downward rays (more than --deg below the horizon) that met nothing
# (ue_frames.py's 16-bit log depth at its far end). A lens over ground sees ground there; nearly all empty is a lens under
# the ground, or over open water (water writes no depth). Prints {worst, frame, frames over --share}.
#   python3 tools/qa/lens_holes.py <clip dir> [--frames a-b] [--deg 12] [--share 0.9] [--json f]
import argparse, json, os
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument('clip'); ap.add_argument('--frames'); ap.add_argument('--deg', type=float, default=12.0)
ap.add_argument('--share', type=float, default=0.9); ap.add_argument('--json')
A = ap.parse_args()
cams = json.load(open(os.path.join(A.clip, '_depth', 'cams.json')))['frames']
ks = sorted(map(int, cams)); a, b = map(int, A.frames.split('-')) if A.frames else (ks[0], ks[-1])
worst, over = (0.0, None), []
for f in range(a, b + 1):
    p = os.path.join(A.clip, '_depth', f'depth_{f:04d}.png')
    if not os.path.exists(p) or str(f) not in cams: continue
    d = np.asarray(Image.open(p))[::4, ::4]; H, W = d.shape
    m = np.array(cams[str(f)]['m']); vf = cams[str(f)]['vf']
    tx, ty = vf[0][0] / -vf[0][2], vf[0][1] / -vf[0][2]
    X, Y = np.meshgrid(((np.arange(W) + 0.5) / W * 2 - 1) * tx, (1 - (np.arange(H) + 0.5) / H * 2) * ty)
    dy = (X * m[1][0] + Y * m[1][1] - m[1][2]) / np.sqrt(X * X + Y * Y + 1.0)   # the ray's world vertical, unit length
    steep = dy < -np.sin(np.radians(A.deg))
    if steep.sum() < 50: continue
    s = float(((d >= 65000) & steep).sum()) / float(steep.sum())
    if s > worst[0]: worst = (s, f)
    if s >= A.share: over.append(f)
R = {'clip': A.clip, 'frames': [a, b], 'worst': round(worst[0], 3), 'worst_frame': worst[1], 'over': len(over), 'over_first': over[:1], 'over_last': over[-1:]}
if A.json: json.dump(R, open(A.json, 'w'))
print(json.dumps(R))
