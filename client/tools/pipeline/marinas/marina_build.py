"""Marina kit data (city-wide, by rule): the docks as centrelines from OpenStreetMap's man_made=pier lines (ODbL), the
slab cleanup of the sources that draw them as solid ground, the gangways, pilings and moored boats, per 512 m tile.

Rules
  dock lines   open man_made=pier ways, clipped to the water (the land polygon less its thin strips). A line is a FLOATING
               dock where it is tagged floating=yes, lies in a leisure=marina area, is named '... Dock', or within 25 m of a
               floating line; else a FIXED timber pier on pilings. A floating line under 22 m with an end on another dock is
               a FINGER (1.1 m), a longer one a MAIN dock (2.4 m); a fixed pier 3.0 m; width= wins.
  slabs        the sources' solid shapes the kit replaces, logged per class:
               coastPier   a planimetric pier outline (coast.json, drawn by wshCoast as a concrete deck with a fascia) whose
                           area is mostly thin (opening by 3.5 m keeps under 40 %) and holds a dock line: the kit's docks
               sliver      a thin planimetric pier piece (under 3 m across or under 25 m2) with no dock line: dropped
               landStrip   the land polygon's thin strips (opening by 3.5 m) within 12 m of a dock line: their compiled ground
                           sunk under the water by the page (marinaKit.js slab-out polygons)
               (buildings: zero-height plates over water and overlapping duplicates, audit_slabs.mjs, merged here)
  gangways     a main dock's end within 6 m of the solid land: the first 12 m of the dock is a hinged aluminium gangway
               from the bulkhead cap down to the float; a floating network with no such end gets one from its nearest point
               if the shore is within 40 m
  boats        each finger's two slips hold a boat by a hash (70 %), its length 0.85 of the finger (7 to 16 m); main docks
               with no finger within 8 m take boats moored alongside every 14 m on the water side (55 %); a boat that would
               touch the land, a dock or another boat is not placed
usage: python3 tools/pipeline/marinas/marina_build.py [--audit audit.json]   (from client/; writes public/data/marinas/marinas.json)
"""
import json, math, os, sys, hashlib
from shapely.geometry import shape, LineString, Point, Polygon, MultiPolygon, box
from shapely.ops import unary_union, substring
from shapely.strtree import STRtree
from shapely import prepared

LAT0, LON0, M_LAT = 40.7831, -73.9712, 111132.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
TILE = 512
P = lambda lon, lat: ((lon - LON0) * M_LON, -(lat - LAT0) * M_LAT)
H = lambda *a: int(hashlib.md5(repr(a).encode()).hexdigest()[:8], 16) / 0xffffffff
COAST = os.environ.get('COAST_JSON', 'public/data/hhp_p2/coast.json')
OUT = os.environ.get('MARINA_OUT', 'public/data/marinas/marinas.json')


def polys(g):
    if g is None or g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    return [p for q in getattr(g, 'geoms', []) for p in polys(q)]


def lines(g):
    if g is None or g.is_empty: return []
    if isinstance(g, LineString): return [g]
    return [p for q in getattr(g, 'geoms', []) for p in lines(q)]


def main():
    audit = None
    if '--audit' in sys.argv: audit = json.load(open(sys.argv[sys.argv.index('--audit') + 1]))
    D = json.load(open('data/raw/osm_docks.json'))
    land = unary_union([shape(f['geometry']).buffer(0) for f in json.load(open('data/raw/boundaries.geojson'))['features']])
    land = unary_union([Polygon([P(*c) for c in p.exterior.coords], [[P(*c) for c in r.coords] for r in p.interiors]) for p in polys(land)])
    solid = land.buffer(-3.5, join_style=2).buffer(3.5, join_style=2)
    strips = [p for p in polys(land.difference(solid)) if p.area > 15]
    marinas = [Polygon([P(*c) for c in m['pts']]).buffer(0) for m in D['marinas'] if m['closed'] and len(m['pts']) > 3]
    marinaU = unary_union(marinas) if marinas else Polygon()
    # (walkways: in a mapped marina, the land polygon's pieces 7 to 24 m across (opening by 12 m takes them, by 3.5 m does
    # not) are its fixed docks and breakwater walks drawn as land: they go to the kit too, their dock lines kept whole)
    core = land.buffer(-12, join_style=2).buffer(12, join_style=2)
    walks = [p for p in polys(solid.difference(core).intersection(marinaU.buffer(5))) if p.area > 30]
    if walks: solid = solid.difference(unary_union(walks).buffer(0.5))
    solidP = prepared.prep(solid)
    log = {'osm_lines': 0, 'floating': 0, 'fixed': 0, 'fingers': 0, 'mains': 0, 'clipped_on_land_m': 0.0}
    raw = []
    for p in D['piers']:
        t = p['tags']
        if p['closed'] or t.get('man_made') != 'pier': continue
        L = LineString([P(*c) for c in p['pts']])
        if L.length < 2: continue
        log['osm_lines'] += 1
        wet = L.difference(solid.buffer(0.3))
        log['clipped_on_land_m'] += L.length - wet.length
        for s in lines(wet):
            if s.length < 2: continue
            # (a line hugging a solid pier's or bulkhead's edge, or one mostly on the land, is the edge of a solid shape:
            # no dock there; logged as edge lines)
            if s.buffer(1.5, cap_style=2).intersection(solid).area > 0.3 * s.length * 3.0 or wet.length < 0.5 * L.length:
                log['edge_lines'] = log.get('edge_lines', 0) + 1; continue
            raw.append({'id': p['id'], 'L': s, 'full': L, 't': t})
    fl0 = [r['L'] for r in raw if r['t'].get('floating') == 'yes']
    flU = unary_union(fl0).buffer(25) if fl0 else Polygon()
    for r in raw:
        t = r['t']
        if t.get('floating') == 'no' and 'Dock' not in t.get('name', ''): r['float'] = False
        else: r['float'] = t.get('floating') == 'yes' or 'Dock' in t.get('name', '') or bool(t.get('mooring')) or r['L'].intersects(marinaU) or r['L'].within(flU)
    tree = STRtree([r['L'] for r in raw])
    for i, r in enumerate(raw):
        L = r['L']
        ends = [Point(L.coords[0]), Point(L.coords[-1])]
        touch = any(any(j != i and raw[j]['L'].distance(e) < 2.0 for j in tree.query(e.buffer(2.0))) for e in ends)
        r['kind'] = ('finger' if r['float'] and L.length < 22 and touch else 'main') if r['float'] else 'fixed'
        try: w = float((str(r['t'].get('width', '')).replace('m', ' ').split() or ['0'])[0])
        except ValueError: w = 0
        r['w'] = w if 0.6 < w < 12 else {'finger': 1.0, 'main': 2.4, 'fixed': 3.0}[r['kind']]
        log['fingers' if r['kind'] == 'finger' else 'mains' if r['kind'] == 'main' else 'fixed'] += 1
        if r['float']: log['floating'] += 1
    dockU = unary_union([r['L'].buffer(r['w'] / 2 + 0.2, cap_style=2) for r in raw]) if raw else Polygon()
    near = unary_union([r['L'] for r in raw]).buffer(12) if raw else Polygon()
    # ---- slabs
    slab = {'coastPier': 0, 'coastPier_m2': 0.0, 'sliver': 0, 'sliver_m2': 0.0, 'landStrip': 0, 'landStrip_m2': 0.0, 'coastPier_kept_solid': 0}
    tiles = {}
    T = lambda k: tiles.setdefault(k, {'docks': [], 'gangways': [], 'pilings': [], 'cleats': [], 'boats': [], 'slabOut': [], 'dropPier': [], 'dropBldg': []})
    keyOf = lambda x, z: f'{math.floor(x / TILE)}_{math.floor(z / TILE)}'
    lines_all = unary_union([r['L'] for r in raw]) if raw else None
    if os.path.exists(COAST):
        C = json.load(open(COAST))
        for k, tl in C['tiles'].items():
            for pr in tl['piers']:
                g = Polygon(pr['ring']).buffer(0)
                if g.is_empty: continue
                op = g.buffer(-3.5, join_style=2).buffer(3.5, join_style=2)
                thin = g.area > 0 and op.area / g.area < 0.4
                has = lines_all is not None and g.buffer(1.0).intersects(lines_all)
                if (thin or (walks and g.representative_point().within(unary_union(walks).buffer(1)))) and has:
                    T(k)['dropPier'].append(pr['id']); slab['coastPier'] += 1; slab['coastPier_m2'] += g.area
                elif g.area < 25 or (thin and g.area / max(g.length / 2, 1e-3) < 3.0):
                    T(k)['dropPier'].append(pr['id']); slab['sliver'] += 1; slab['sliver_m2'] += g.area
                elif thin: slab['coastPier_kept_solid'] += 1
    # (the compile's bulkhead walls and aprons stand off the strips' edges, out over the water: the slab-out takes each dock's
    # corridor too, its width plus 8 m a side (the walls stand up to ~6 m off a 4 m strip, the 16 m grid's steps), less the solid land and 1.5 m off it, where the shore's own walls stay)
    corr = unary_union([r['L'].buffer(r['w'] / 2 + 8.0, cap_style=2) for r in raw]).difference(solid.buffer(1.5)) if raw else Polygon()
    cand = [s for s in strips if s.intersects(near)] + walks
    slab['marinaWalk'] = len(walks); slab['marinaWalk_m2'] = sum(w.area for w in walks)
    slab['landStrip'] = len(cand); slab['landStrip_m2'] = sum(s.area for s in cand)
    slab['corridor_m2'] = corr.area
    # (the strips' and walks' own walls stand up to ~6 m off them too: each taken with 6 m round it, less the solid land)
    for s in polys(unary_union([c.buffer(6.0, join_style=2) for c in cand] + [corr]).difference(solid.buffer(1.5))):
        if False: continue
        g = s.buffer(0.6, join_style=2).simplify(0.2)
        for gp in polys(g):
            x0, z0, x1, z1 = gp.bounds
            for tx in range(math.floor(x0 / TILE), math.floor(x1 / TILE) + 1):
                for tz in range(math.floor(z0 / TILE), math.floor(z1 / TILE) + 1):
                    part = gp.intersection(box(tx * TILE - 4, tz * TILE - 4, tx * TILE + TILE + 4, tz * TILE + TILE + 4))
                    for q in polys(part):
                        T(f'{tx}_{tz}')['slabOut'].append([[round(x, 2), round(z, 2)] for x, z in q.exterior.coords])
    # ---- docks, gangways, pilings, cleats
    occ = [dockU]
    gw = 0
    for i, r in enumerate(raw):
        L = r['L']
        y = 0.6 if r['float'] else 2.6
        pts = [list(c) for c in L.coords]
        if r['kind'] == 'main':
            for end in (0, 1):
                e = Point(pts[0] if end == 0 else pts[-1])
                if solid.distance(e) < 6.0 and L.length > 16:
                    g = 12.0
                    a = substring(L, 0, g) if end == 0 else substring(L, L.length - g, L.length)
                    rest = substring(L, g, L.length) if end == 0 else substring(L, 0, L.length - g)
                    ac = list(a.coords)
                    if end == 1: ac = ac[::-1]
                    k = keyOf(*ac[0])
                    T(k)['gangways'].append({'a': [round(v, 2) for v in ac[0]], 'b': [round(v, 2) for v in ac[-1]], 'y0': 3.75, 'y1': y + 0.25, 'w': 1.4})
                    gw += 1
                    L = rest; pts = [list(c) for c in L.coords]
        if L.length < 1.5: continue
        mid = L.interpolate(0.5, normalized=True)
        k = keyOf(mid.x, mid.y)
        T(k)['docks'].append({'pts': [[round(x, 2), round(z, 2)] for x, z in pts], 'w': r['w'], 'y': y, 'kind': r['kind'], 'id': r['id']})
        # pilings: floating mains every 12 m alternating sides, fingers at the tip on the slip side, fixed piers in bents of 2 every 3.6 m
        step = 12.0 if r['kind'] == 'main' else 3.6
        if r['kind'] in ('main', 'fixed'):
            n = max(1, int(L.length // step))
            for j in range(n + 1):
                d = min(L.length, j * L.length / n) if n else 0
                p0 = L.interpolate(max(0, d - 0.5)); p1 = L.interpolate(min(L.length, d + 0.5))
                dx, dz = p1.x - p0.x, p1.y - p0.y; ln = math.hypot(dx, dz) or 1
                nx, nz = -dz / ln, dx / ln
                c = L.interpolate(d)
                sides = (1, -1) if r['kind'] == 'fixed' else ((1,) if j % 2 == 0 else (-1,))
                for sd in sides:
                    off = r['w'] / 2 + (0.25 if r['kind'] == 'main' else -0.2)
                    px, pz = c.x + nx * off * sd, c.y + nz * off * sd
                    T(keyOf(px, pz))['pilings'].append([round(px, 2), round(pz, 2), 0.36 if r['kind'] == 'main' else 0.3, 3.9 if r['kind'] == 'main' else y + 0.05])
        else:
            e = Point(pts[-1]); s0 = Point(pts[0])
            tip = e if min((raw[j]['L'].distance(e) for j in tree.query(e.buffer(2.5)) if j != i), default=99) > min((raw[j]['L'].distance(s0) for j in tree.query(s0.buffer(2.5)) if j != i), default=99) else s0
            T(keyOf(tip.x, tip.y))['pilings'].append([round(tip.x, 2), round(tip.y, 2), 0.32, 3.6])
        # cleats every 5 m both edges (floating), every 8 m (fixed)
        cs = 5.0 if r['float'] else 8.0
        for j in range(1, max(1, int(L.length // cs))):
            d = j * cs
            p0 = L.interpolate(max(0, d - 0.5)); p1 = L.interpolate(min(L.length, d + 0.5))
            dx, dz = p1.x - p0.x, p1.y - p0.y; ln = math.hypot(dx, dz) or 1
            c = L.interpolate(d)
            for sd in (1, -1):
                off = r['w'] / 2 - 0.15
                T(keyOf(c.x, c.y))['cleats'].append([round(c.x - dz / ln * off * sd, 2), round(c.y + dx / ln * off * sd, 2), round(math.atan2(dz, dx), 3), y])
    # gangways for floating networks with no shore end
    fl = [r for r in raw if r['float']]
    nets = list(unary_union([r['L'].buffer(1.5) for r in fl]).geoms) if fl else []
    if fl and isinstance(unary_union([r['L'].buffer(1.5) for r in fl]), Polygon): nets = [unary_union([r['L'].buffer(1.5) for r in fl])]
    gwPts = [Point(g['a']) for t in tiles.values() for g in t['gangways']]
    for n in nets:
        if any(n.distance(p) < 14 for p in gwPts): continue
        d = n.distance(solid)
        if d > 40 or d < 0.5: continue
        from shapely.ops import nearest_points
        a, b = nearest_points(n.buffer(-1.0) if not n.buffer(-1.0).is_empty else n, solid)
        T(keyOf(b.x, b.y))['gangways'].append({'a': [round(b.x, 2), round(b.y, 2)], 'b': [round(a.x, 2), round(a.y, 2)], 'y0': 3.75, 'y1': 0.85, 'w': 1.4})
        gw += 1
    log['gangways'] = gw
    # ---- boats
    landP = prepared.prep(land.buffer(1.0))
    placed = []
    btree_geoms = []
    def ok(fp):
        if landP.intersects(fp) or dockU.intersection(fp).area > 0.02 * fp.area: return False
        if fp.distance(dockU) > 0.9: return False   # (a boat lies in a slip or alongside: within 0.9 m of a dock's edge)
        return not any(fp.intersects(q) for q in btree_geoms[-400:] if q.distance(fp) < 1)
    fingers = [r for r in raw if r['kind'] == 'finger']
    nb = 0
    for r in fingers:
        L = r['L']; ln = L.length
        a, b = L.coords[0], L.coords[-1]
        dx, dz = (b[0] - a[0]) / ln, (b[1] - a[1]) / ln
        blen = max(7.0, min(16.0, ln * 0.8)); beam = blen * 0.3
        # (the root: the end on another dock; the boat lies from 1 m off the main dock outward)
        e0, e1 = Point(a), Point(b)
        r0 = min((raw[j]['L'].distance(e0) for j in tree.query(e0.buffer(2.5)) if raw[j] is not r), default=99)
        r1 = min((raw[j]['L'].distance(e1) for j in tree.query(e1.buffer(2.5)) if raw[j] is not r), default=99)
        root = 0 if r0 <= r1 else 1
        dm = 1.6 + blen / 2 if root == 0 else ln - 1.6 - blen / 2
        if dm < 0 or dm > ln: dm = ln / 2
        c = L.interpolate(dm)
        for sd in (1, -1):
            if H(r['id'], sd) > 0.7: continue
            off = r['w'] / 2 + 0.45 + beam / 2
            cx, cz = c.x - dz * off * sd, c.y + dx * off * sd
            yaw = math.atan2(dz, dx) + (math.pi if H(r['id'], sd, 'b') < 0.5 else 0)
            fp = Polygon([(cx + dx * blen / 2 - dz * beam / 2, cz + dz * blen / 2 + dx * beam / 2), (cx + dx * blen / 2 + dz * beam / 2, cz + dz * blen / 2 - dx * beam / 2),
                          (cx - dx * blen / 2 + dz * beam / 2, cz - dz * blen / 2 - dx * beam / 2), (cx - dx * blen / 2 - dz * beam / 2, cz - dz * blen / 2 + dx * beam / 2)])
            if not ok(fp): continue
            btree_geoms.append(fp)
            kind = 'sail' if H(r['id'], sd, 'k') < 0.35 else 'motor'
            T(keyOf(cx, cz))['boats'].append([round(cx, 2), round(cz, 2), round(yaw, 3), round(blen, 2), kind, round(H(r['id'], sd, 'c'), 3)])
            nb += 1
    fingU = unary_union([r['L'] for r in fingers]).buffer(8) if fingers else Polygon()
    for r in raw:
        if r['kind'] != 'main' or not r['float']: continue
        L = r['L']
        for j in range(int(L.length // 14)):
            d = 7 + j * 14
            if d > L.length - 4: break
            c = L.interpolate(d)
            if fingU.contains(c): continue
            p0 = L.interpolate(d - 0.5); p1 = L.interpolate(min(L.length, d + 0.5))
            dx, dz = p1.x - p0.x, p1.y - p0.y; ln = math.hypot(dx, dz) or 1; dx /= ln; dz /= ln
            for sd in (1, -1):
                if H(r['id'], j, sd) > 0.55: continue
                blen = 8 + 6 * H(r['id'], j, sd, 'l'); beam = blen * 0.32
                off = r['w'] / 2 + 0.45 + beam / 2
                cx, cz = c.x - dz * off * sd, c.y + dx * off * sd
                fp = Point(cx, cz).buffer(1).union(LineString([(cx - dx * blen / 2, cz - dz * blen / 2), (cx + dx * blen / 2, cz + dz * blen / 2)]).buffer(beam / 2, cap_style=2))
                if not ok(fp): continue
                btree_geoms.append(fp)
                kind = 'sail' if H(r['id'], j, sd, 'k') < 0.3 else 'motor'
                T(keyOf(cx, cz))['boats'].append([round(cx, 2), round(cz, 2), round(math.atan2(dz, dx) + (math.pi if H(r['id'], j, 'f') < 0.5 else 0), 3), round(blen, 2), kind, round(H(r['id'], j, sd, 'c'), 3)])
                nb += 1
    log['boats'] = nb
    if audit:
        for k, idx in audit.get('drop', {}).items(): T(k)['dropBldg'] = sorted(set(idx))
        log['bldg_audit'] = audit.get('counts', {})
    tiles = {k: v for k, v in tiles.items() if any(v[q] for q in v)}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'tool': 'tools/pipeline/marinas/marina_build.py', 'source': 'OpenStreetMap contributors (ODbL); NYC planimetrics; DCP borough boundaries',
               'log': log, 'slabs': slab, 'tiles': tiles}, open(OUT, 'w'), separators=(',', ':'))
    print(json.dumps({'log': log, 'slabs': {k: (round(v) if isinstance(v, float) else v) for k, v in slab.items()}, 'tiles': len(tiles)}))


if __name__ == '__main__':
    main()
