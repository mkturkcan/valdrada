"""Dock, pier and marina features of OpenStreetMap (ODbL, (c) OpenStreetMap contributors) inside NYC's box, from the
backdrop's new-york-latest.osm.pbf: man_made=pier ways (lines = dock centrelines, closed = pier areas), floating,
leisure=marina areas, mooring points. Writes data/raw/osm_docks.json for the marina kit (marina_build.py).
usage: python3 tools/pipeline/marinas/extract_docks.py   (run from client/)"""
import json, os, osmium
BOX = (-74.27, 40.48, -73.68, 40.93)
PBF = 'data/raw/backdrop/osm/new-york-latest.osm.pbf'
inb = lambda lon, lat: BOX[0] <= lon <= BOX[2] and BOX[1] <= lat <= BOX[3]
out = {'source': 'OpenStreetMap (ODbL)', 'piers': [], 'marinas': [], 'moorings': []}
class H(osmium.SimpleHandler):
    def way(self, w):
        t = w.tags
        mm, le = t.get('man_made'), t.get('leisure')
        if mm not in ('pier', 'breakwater', 'groyne') and le not in ('marina', 'slipway') and t.get('seamark:type') not in ('pontoon', 'mooring'):
            return
        try: pts = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError: return
        if len(pts) < 2 or not any(inb(*p) for p in pts): return
        rec = {'id': w.id, 'pts': [[round(a, 7), round(b, 7)] for a, b in pts], 'closed': pts[0] == pts[-1],
               'tags': {k: v for k, v in t if k in ('man_made', 'leisure', 'floating', 'name', 'width', 'surface', 'mooring', 'seamark:type', 'access', 'building', 'layer', 'area')}}
        (out['marinas'] if le == 'marina' else out['piers']).append(rec)
    def node(self, n):
        t = n.tags
        if t.get('leisure') == 'marina' or t.get('mooring') or t.get('seamark:type') in ('mooring', 'pontoon'):
            if inb(n.location.lon, n.location.lat):
                out['moorings'].append({'id': n.id, 'pt': [n.location.lon, n.location.lat], 'tags': dict(t)})
H().apply_file(PBF, locations=True)
json.dump(out, open('data/raw/osm_docks.json', 'w'))
print('piers/docks', len(out['piers']), 'lines', sum(not p['closed'] for p in out['piers']), 'floating', sum(p['tags'].get('floating') == 'yes' for p in out['piers']),
      'marinas', len(out['marinas']), 'points', len(out['moorings']))
