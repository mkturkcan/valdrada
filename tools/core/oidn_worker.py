"""The denoiser for path-traced replay frames (tools/core/replay.mjs --oidn): Intel Open Image Denoise on a CUDA GPU,
fed on stdin by the replay with each frame's noisy image (the film look's sRGB output) and its guides (the base colour
and the world normals of the raster passes), writing the denoised frame as JPEG. Unreal's own denoiser for the path
tracer (NNEDenoiser) runs on the CPU on Linux, 0.4-1.2 s a 2560x1440 frame; this one takes about 40 ms with its
transfers.

With --temporal the frame then goes through a temporal pass against the denoiser's frame-to-frame flicker (each
frame's residual noise is its own): the previous output reprojected through this frame's planar depth and the two
cameras (bicubic), kept where the previous frame's depth agrees within 2 % and on screen, clamped to this frame's 3 x 3
neighbourhood (min / max, against ghosting where the scene moved), and blended: out = a * history + (1 - a) * current.
It runs on the same GPU through torch.

stdin, per frame: u32 (little endian) header length, the header JSON {file, w, h, quality, oidn, [temporal, cam]}, then
three planes of w x h x 4 bytes (rgba8): colour, albedo, normal (0.5 + 0.5 n); with temporal a fourth, the planar depth
as float32 metres, and cam {m: three's column-major camera matrixWorld, fov: vertical degrees}. stdout: one JSON line
per frame written.

Needs the pyoidn package (pip install pyoidn; its wheel carries OIDN with the CUDA device): VALDRADA_PYOIDN names a
folder it was installed into with --target. The GPU is CUDA's: CUDA_DEVICE_ORDER=PCI_BUS_ID and CUDA_VISIBLE_DEVICES.
"""
import json
import math
import os
import struct
import sys
import time

sys.path.append(os.environ.get('VALDRADA_PYOIDN', '/data0/projectnyc_aux/dev/v2/speed/pyoidn'))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
import pyoidn  # noqa: E402
from pyoidn.buffer import Buffer  # noqa: E402
from pyoidn.device import Device  # noqa: E402
from pyoidn.filter import Filter  # noqa: E402

QUALITY = {'high': pyoidn.OIDN_QUALITY_HIGH, 'balanced': pyoidn.OIDN_QUALITY_BALANCED, 'fast': pyoidn.OIDN_QUALITY_FAST}


class Temporal:
    """The temporal pass (see above); the previous frame's output, depth and camera kept on the GPU."""

    def __init__(self):
        import torch
        import torch.nn.functional as fn
        self.t, self.fn, self.dev = torch, fn, torch.device('cuda')
        self.prev = None
        self.grid = None

    @staticmethod
    def cam(c):
        m = np.array(c['m'], np.float64).reshape(4, 4).T   # (column-major: the transpose is camera to world)
        return m, math.tan(math.radians(c['fov']) / 2)

    def __call__(self, out, depth, cam, a):
        t, fn, dev = self.t, self.fn, self.dev
        h, w = depth.shape
        cur = t.from_numpy(out).to(dev).permute(2, 0, 1).contiguous()
        dep = t.from_numpy(depth).to(dev).float()
        m, th = self.cam(cam)
        if self.prev is not None and self.prev[0].shape == cur.shape:
            hist, pdep, pm, pth = self.prev
            if self.grid is None or self.grid[0].shape != (h, w):
                ys, xs = t.meshgrid(t.arange(h, device=dev, dtype=t.float32) + 0.5, t.arange(w, device=dev, dtype=t.float32) + 0.5, indexing='ij')
                self.grid = (xs / w * 2 - 1, 1 - ys / h * 2)
            nx, ny = self.grid
            asp = w / h
            # this frame's pixels to world (the camera looks down -z; depth along the view axis), then into the previous camera
            v = t.stack([nx * th * asp * dep, ny * th * dep, -dep], -1)
            r = t.from_numpy(m[:3, :3]).to(dev).float(); o = t.from_numpy(m[:3, 3]).to(dev).float()
            inv = np.linalg.inv(pm)
            ri = t.from_numpy(inv[:3, :3]).to(dev).float(); oi = t.from_numpy(inv[:3, 3]).to(dev).float()
            q = (v @ r.T + o) @ ri.T + oi
            zp = -q[..., 2]
            zc = zp.clamp(min=1e-3)
            gx = q[..., 0] / zc / (pth * asp)
            gy = -q[..., 1] / zc / pth
            grid = t.stack([gx, gy], -1)[None]
            hh = fn.grid_sample(hist[None], grid, mode='bicubic', padding_mode='border', align_corners=False)[0]
            dz = fn.grid_sample(pdep[None, None], grid, mode='nearest', padding_mode='border', align_corners=False)[0, 0]
            ok = (zp > 0.5) & (gx.abs() < 1 - 2 / w) & (gy.abs() < 1 - 2 / h) & ((dz - zp).abs() < 0.02 * zp)
            lo = -fn.max_pool2d(-cur[None], 3, 1, 1)[0]
            hi = fn.max_pool2d(cur[None], 3, 1, 1)[0]
            hh = t.minimum(t.maximum(hh, lo), hi)
            cur = t.where(ok[None], a * hh + (1 - a) * cur, cur)
        self.prev = (cur, dep, m, th)
        return cur.clamp(0, 1).permute(1, 2, 0).cpu().numpy()


def main():
    dev = Device(pyoidn.OIDN_DEVICE_TYPE_CUDA)
    dev.commit()
    inp = sys.stdin.buffer
    sizes = {}
    temporal = None

    def read(n):
        out = bytearray(n)
        mv = memoryview(out)
        got = 0
        while got < n:
            k = inp.readinto(mv[got:])
            if not k:
                return None
            got += k
        return out

    while True:
        head = read(4)
        if head is None:
            break
        meta = json.loads(bytes(read(struct.unpack('<I', head)[0])))
        w, h = meta['w'], meta['h']
        t0 = time.time()
        planes = [np.frombuffer(read(w * h * 4), np.uint8).reshape(h, w, 4) for _ in range(3)]
        depth = np.frombuffer(read(w * h * 4), np.float32).reshape(h, w) if meta.get('temporal') is not None else None
        key = (w, h)
        if key not in sizes:
            n = w * h * 3 * 4
            bufs = {k: Buffer(dev, n) for k in ('color', 'albedo', 'normal', 'output')}
            flt = Filter(dev, pyoidn.OIDN_FILTER_TYPE_RT)
            for k, name in (('color', pyoidn.OIDN_IMAGE_COLOR), ('albedo', pyoidn.OIDN_IMAGE_ALBEDO), ('normal', pyoidn.OIDN_IMAGE_NORMAL),
                            ('output', pyoidn.OIDN_IMAGE_OUTPUT)):
                flt.set_image(name, bufs[k], pyoidn.OIDN_FORMAT_FLOAT3, w, h)
            flt.set_bool('hdr', False)
            flt.set_bool('srgb', True)   # (the film look's output is sRGB encoded)
            flt.set_quality(QUALITY.get(meta.get('oidn', 'high'), pyoidn.OIDN_QUALITY_HIGH))
            flt.commit()
            sizes[key] = (bufs, flt, n)
        bufs, flt, n = sizes[key]
        color = np.ascontiguousarray(planes[0][..., :3], dtype=np.float32) * (1.0 / 255.0)
        albedo = np.ascontiguousarray(planes[1][..., :3], dtype=np.float32) * (1.0 / 255.0)
        normal = np.ascontiguousarray(planes[2][..., :3], dtype=np.float32) * (2.0 / 255.0) - 1.0
        t1 = time.time()
        bufs['color'].write(0, n, color)
        bufs['albedo'].write(0, n, albedo)
        bufs['normal'].write(0, n, normal)
        flt.execute()
        out = np.empty((h, w, 3), np.float32)
        bufs['output'].read(0, n, out)
        t2 = time.time()
        if depth is not None:
            if temporal is None:
                temporal = Temporal()
            out = temporal(out, depth, meta['cam'], float(meta['temporal']))
        t3 = time.time()
        Image.fromarray((np.clip(out, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)).save(meta['file'], quality=int(meta.get('quality', 95)))
        t4 = time.time()
        sys.stdout.write(json.dumps({'file': meta['file'], 'unpack_ms': round((t1 - t0) * 1000, 1), 'denoise_ms': round((t2 - t1) * 1000, 1),
                                     'temporal_ms': round((t3 - t2) * 1000, 1), 'jpeg_ms': round((t4 - t3) * 1000, 1)}) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
