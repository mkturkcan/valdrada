"""Slab audit of the compiled tiles' buildings (city-wide, by rule): the source classes that extrude badly.
  plate       a footprint under 0.8 m tall (zero-height plates: canopies, markings and sheds drawn flat)
  overWater   a footprint 80 % or more over the water and under 4 m tall (pier slabs, floats and barges drawn as buildings)
  duplicate   a footprint that overlaps another in the same tile by 85 % or more of the smaller one's area (the lower of the
              two goes; same height: the later record)
usage: python3 tools/pipeline/marinas/audit_slabs.py <tilesDir> <out.json>   (from client/, for data/raw/boundaries.geojson)
"""
import json, math, os, struct, sys
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely import prepared

LAT0, LON0, M_LAT = 40.7831, -73.9712, 111132.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
TYP = {'Float32Array': 'f', 'Uint8Array': 'B', 'Uint32Array': 'I', 'Int16Array': 'h', 'Uint16Array': 'H'}


def polys(g):
    if isinstance(g, Polygon): return [g]
    return [p for q in getattr(g, 'geoms', []) for p in polys(q)]


def tile(fn):
    b = open(fn, 'rb').read()
    hl = struct.unpack_from('<I', b, 4)[0]
    h = json.loads(b[8:8 + hl]); base = 8 + hl + ((4 - ((8 + hl) % 4)) % 4)
    S = {}
    for s in h['sections']:
        if s['name'] in ('bldg', 'bldgXZ'):
            sz = struct.calcsize(TYP[s['type']]); S[s['name']] = (b[base + s['offset']: base + s['offset'] + s['length'] * sz], TYP[s['type']], s['length'])
    return h, S


def main():
    tdir, out = sys.argv[1], sys.argv[2]
    P = lambda lon, lat: ((lon - LON0) * M_LON, -(lat - LAT0) * M_LAT)
    land = unary_union([Polygon([P(*c) for c in p.exterior.coords], [[P(*c) for c in r.coords] for r in p.interiors])
                        for f in json.load(open('data/raw/boundaries.geojson'))['features'] for p in polys(shape(f['geometry']).buffer(0))])
    landP = prepared.prep(land)
    man = json.load(open(os.path.join(tdir, 'manifest.json')))
    counts = {'buildings': 0, 'plate': 0, 'overWater': 0, 'duplicate': 0}
    drop = {}
    for k, e in man['tiles'].items():
        h, S = tile(os.path.join(tdir, e['f']))
        if 'bldg' not in S: continue
        ox, oz = h['origin']
        meta = S['bldg'][0]; xz = struct.unpack(f"<{S['bldgXZ'][2]}f", S['bldgXZ'][0])
        n = len(meta) // 44
        recs = []
        for i in range(n):
            st, ln = struct.unpack_from('<IH', meta, i * 44)
            hgt = struct.unpack_from('<f', meta, i * 44 + 12)[0]
            ring = [(xz[2 * j] + ox, xz[2 * j + 1] + oz) for j in range(st, st + ln)]
            if len(ring) < 3: continue
            g = Polygon(ring).buffer(0)
            if g.is_empty: continue
            recs.append((i, g, hgt))
        counts['buildings'] += len(recs)
        D = set()
        for i, g, hgt in recs:
            if hgt < 0.8: D.add(i); counts['plate'] += 1; continue
            if hgt < 4.0 and not landP.contains(g):
                wet = g.difference(land).area / max(g.area, 1e-6)
                if wet >= 0.8: D.add(i); counts['overWater'] += 1
        live = [(i, g, hgt) for i, g, hgt in recs if i not in D]
        T = STRtree([g for _, g, _ in live])
        for a, (i, g, hgt) in enumerate(live):
            if i in D: continue
            for b in T.query(g):
                if b <= a: continue
                j, g2, h2 = live[b]
                if j in D: continue
                inter = g.intersection(g2).area
                if inter >= 0.85 * min(g.area, g2.area):
                    lo = j if (h2 < hgt or (h2 == hgt and j > i)) else i
                    D.add(lo); counts['duplicate'] += 1
                    if lo == i: break
        if D: drop[k] = sorted(D)
    json.dump({'tool': 'tools/pipeline/marinas/audit_slabs.py', 'counts': counts, 'drop': drop}, open(out, 'w'), separators=(',', ':'))
    print(json.dumps(counts), 'tiles with drops', len(drop))


if __name__ == '__main__':
    main()
