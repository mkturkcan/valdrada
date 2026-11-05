"""The city manifest the client reads at start (Data/city.json), from the version 2 city build's manifests
(tools/ue/city_build.py: ue_cache/city_v2/cells.json, far.json, cells.txt) and the far chunks' index
(cellcache/lod16/index.json): which level draws each 1 km block, each far package and each landmark, and which kit table
each 128 m cell assembles (ValdradaCells). Only levels and tables present on disk are listed. Data/classes.json: per block
level, the semantic class (client/src/perception/segRender.js CLASS_ROWS ids) of each of its merged meshes (g<n>) and
instance sets (s<n>) from the block package's node extras (tools/ue/block_merge.py keeps each node's `class`).

    python3 ue_client/ValdradaUE/Tools/make_manifests.py [--city /data0/projectnyc_aux/ue_cache/city_v2]
        [--content <project Content>] [--out ue_client/ValdradaUE/Data/city.json]
"""
import argparse
import collections
import json
import math
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CELL, BLOCK = 128.0, 1024.0


def block_of(k):
    cx, cz = map(int, k.split('_'))
    return (math.floor(cx * CELL / BLOCK), math.floor(cz * CELL / BLOCK))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--city', default='/data0/projectnyc_aux/ue_cache/city_v2')
    ap.add_argument('--lod', default='/data0/projectnyc_aux/cellcache/lod16/index.json')
    ap.add_argument('--content', default=os.path.join(HERE, '..', 'Content'))
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'Data', 'city.json'))
    ap.add_argument('--blk', default='/data0/projectnyc_aux/ue_cache/cc/blk', help='the block packages (block_merge.py)')
    a = ap.parse_args()
    content = os.path.realpath(a.content)
    exists = lambda lvl: os.path.exists(os.path.join(content, lvl[len('/Game/'):] + '.umap'))
    cm = json.load(open(os.path.join(a.city, 'cells.json')))
    fm = json.load(open(os.path.join(a.city, 'far.json')))
    lod = json.load(open(a.lod))
    city_cells = open(os.path.join(a.city, 'cells.txt')).read().split()
    cityb = collections.Counter(block_of(k) for k in city_cells)
    out = {'schema': 'valdrada.ue.city/0', 'made': time.strftime('%Y-%m-%d %H:%M:%S'), 'cell': CELL, 'block': BLOCK,
           'sources': {'cells': cm.get('made'), 'far': fm.get('made')}, 'blocks': {}, 'city_blocks': {}, 'cells': {}, 'far': {},
           'chunks': sorted(lod.get('chunks') or {}), 'landmarks': {}, 'missing': {'blocks': 0, 'far': 0, 'tables': 0}}
    for b, n in sorted(cityb.items()): out['city_blocks'][f'{b[0]}_{b[1]}'] = n
    for k, d in sorted(cm['blocks'].items()):
        if exists(d['level']): out['blocks'][k] = d['level']
        else: out['missing']['blocks'] += 1
    for k, d in sorted(cm['cells'].items()):
        t = d.get('table')
        if t and os.path.exists(t): out['cells'][k] = os.path.basename(t)[:-len('.vcel')]
        else: out['missing']['tables'] += 1
    for name, fk in sorted(fm['keys'].items()):
        lvl = f'/Game/CF/{fk}/L'
        if exists(lvl): out['far'][name] = lvl
        else: out['missing']['far'] += 1
    for k, e in sorted((lod.get('landmarks') or {}).items()):
        if not e.get('bounds'): continue
        out['landmarks'][k] = {'bounds': [round(v, 2) for v in e['bounds'][:6]], 'bridge': bool(e.get('kind') == 'bridge' or e.get('drawnBy') == 'bridgeKit')}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(out, open(a.out, 'w'), separators=(',', ':'))
    import re
    import struct
    classes, nodes = {}, 0
    for k, d in sorted(cm['blocks'].items()):
        if k not in out['blocks']: continue
        f = os.path.join(a.blk, d['key'] + '.glb')
        if not os.path.exists(f): continue
        with open(f, 'rb') as fh:
            head = fh.read(20)
            J = json.loads(fh.read(struct.unpack('<I', head[12:16])[0]))
        m = {}
        mats = J.get('materials', [])
        for n in J.get('nodes', []):
            c = (n.get('extras') or {}).get('class')
            g = re.match(r'^(g\d+|s\d+)(_|$)', n.get('name') or '')
            if not (g and isinstance(c, int) and c > 0): continue
            # the tile's ground (one merged mesh on the ground shader, its kinds per vertex in three.js: roads, sidewalks,
            # kerbs, markings) carries one node class; a component has one stencil, so it stays unlabelled rather than all
            # of it 'sidewalk'. On the measured ground (terrain cells) the ground is laid in pieces on plain standard
            # materials, every piece still classed 'sidewalk' whatever its kind (roads included): unlabelled too
            if g.group(1).startswith('g') and 3 <= c <= 14 and 'mesh' in n:
                prims = J['meshes'][n['mesh']].get('primitives', [])
                if any(str((mats[p_['material']] if 'material' in p_ and p_['material'] < len(mats) else {}).get('name', '')).startswith(('ShaderMaterial', 'MeshStandardMaterial')) for p_ in prims):
                    continue
            m[g.group(1)] = c
        classes[d['level']] = m; nodes += len(m)
    json.dump(classes, open(os.path.join(os.path.dirname(os.path.abspath(a.out)), 'classes.json'), 'w'), separators=(',', ':'))
    print('classes:', len(classes), 'block levels,', nodes, 'labelled meshes and sets')
    print(json.dumps({k: (len(v) if isinstance(v, (dict, list)) else v) for k, v in out.items()}))


if __name__ == '__main__':
    main()
