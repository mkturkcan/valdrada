#!/usr/bin/env python3
# WATER3F (2026-10-25): the rivers' fetch map for M_bx_water3f (ue_masters.py). The wind sea of M_bx_water3 is the open
# harbour's (8 km of fetch, the long trains lifted x 1.6); on a channel 100-200 m wide (the Harlem River, Spuyten Duyvil,
# the Bronx Kill, the creeks) that sea is far too long and too high: its crests stand across the channel as dark parallel
# stripes at a grazing view under a wooded bank. Here every water pixel (outside the five boroughs' shoreline-clipped land,
# client/data/raw/boundaries.geojson; New Jersey is not in it, so the Hudson and the kills by it count as wide, as they
# draw now) gets its channel's width, twice the largest distance to the shore within 300 m (a marina's slips or a pier's basin by open water count as wide),
# and t = smoothstep(140 m, 200 m, width): 1 on the Hudson, the East River (its narrowest channel, west of Roosevelt Island,
# is about 240 m), the harbour and the bays, so their sea is the same to the bit; under 1 only on narrow channels, where
# the material's fetch goes to FetchN.x and the long trains' lift to 1. Land pixels take their nearest water pixel's
# value (no bleed of 1 into a channel under bilinear filtering).
#   python3 tools/ue/water_fetch.py <boundaries.geojson> <out.png>   (writes <out>.json: the world rect, x0 z0 1/w 1/h)
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

PX = 16.0
X0, Z0, X1, Z1 = -26624.0, -17408.0, 26624.0, 34816.0   # (the city with a margin, world metres: x east, z south)
LAT0, LON0, ML = 40.7831, -73.9712, 111132.0
MO = 111320.0 * math.cos(math.radians(LAT0))


def main(bnd, out):
    W, H = int((X1 - X0) / PX), int((Z1 - Z0) / PX)
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    px = lambda lon, lat: (((lon - LON0) * MO - X0) / PX, (-(lat - LAT0) * ML - Z0) / PX)  # noqa: E731
    for f in json.load(open(bnd))['features']:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        for poly in polys:
            d.polygon([px(*c[:2]) for c in poly[0]], fill=255)
            for hole in poly[1:]:
                d.polygon([px(*c[:2]) for c in hole], fill=0)
    wat = np.asarray(im) == 0
    dt = ndi.distance_transform_edt(wat) * PX
    k = int(round(300 / PX))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    width = 2.0 * ndi.maximum_filter(dt, footprint=(xx * xx + yy * yy) <= k * k)
    s = np.clip((width - 140.0) / 60.0, 0, 1)
    t = s * s * (3 - 2 * s)
    _, (ri, ci) = ndi.distance_transform_edt(~wat, return_indices=True)
    t = t[ri, ci]
    Image.fromarray(np.round(t * 255).astype(np.uint8), 'L').convert('RGB').save(out, optimize=True)   # (RGB: a linear colour texture in Unreal)
    meta = {'rect': [X0, Z0, 1.0 / (X1 - X0), 1.0 / (Z1 - Z0)], 'px': PX, 'w': W, 'h': H,
            'narrow_px': int(((t < 0.999) & wat).sum()), 'water_px': int(wat.sum())}
    json.dump(meta, open(out[:-4] + '.json', 'w'), indent=1)
    print(json.dumps(meta))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
