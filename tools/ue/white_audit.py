#!/usr/bin/env python3
# WHITE06 (2026-10-26): the city-wide check for buildings that render with no facade pattern, or near-white, in Unreal.
# Every registered cell's glTF JSON (no meshes read): each building-class mesh's material record goes through the same
# branch r1c_cellmat2.py / bd_tilefac.py take when they bind it (tile facade, glass, families, signs, the generic master),
# and the generic master's outcome is recomputed: a map of its own, an HQ set, an alias, a page preview, or none; its
# colour after the record's tint, the kit's base colour, the textureless PBR rule and the alias hold. A key is flagged
#   flat:  the generic master with no texture at all on building geometry (no pattern) and paler than PALE_LUM
#   white: the albedo drawn (colour x its map's mean) over WHITE_LUM, textured or not
# The far tier: the far shells (r1c_lodmat.py) take their colour from the far packages' vertex colour and the facade
# atlas, so their check is far_audit() over the far library's records (the same luminance rule).
#   python3 tools/ue/white_audit.py --out <dir> [--cells @file|a,b] [--jobs 32]      (near: the cells)
#   python3 tools/ue/white_audit.py --out <dir> --far                                 (far: the far library)
import argparse, json, os, re, struct, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REG = '/data0/projectnyc_aux/cellcache/registry/cells.json'
CC = '/data0/projectnyc_aux/cellcache'
WHITE_LUM = 0.5          # (linear luminance: sRGB ~0.73; the golden grade clips a sunlit 0.6+ wall to a blank slab)
PALE_LUM = 0.3           # (flat keys reported from this luminance up: dark trims and iron are meant to be plain)
BUILDING = 2             # (perception/segRender.js CLASS_ROWS)


def lum(c): return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def srgb2lin(c): return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def glb_json(p):
    with open(p, 'rb') as fh:
        h = fh.read(20); L = struct.unpack('<I', h[12:16])[0]; return json.loads(fh.read(L))


def scan_cell(cell_hash):
    cell, h = cell_hash
    p = os.path.join(CC, h, 'cell.glb')
    try: J = glb_json(p)
    except Exception as e: return cell, None, f'{type(e).__name__}'
    mats = J.get('materials', [])
    use = {}
    for n in J.get('nodes', []):
        ex = n.get('extras') or {}
        if 'mesh' not in n or ex.get('class') != BUILDING: continue
        for pr in J['meshes'][n['mesh']]['primitives']:
            mi = pr.get('material')
            if mi is None: continue
            k = mats[mi].get('name') or ''
            t = int(ex.get('tris') or 0) if ex.get('kind') == 'mesh' else 0   # (instances: their prototypes are props, counted apart)
            u = use.setdefault(k, [0, None, False])
            u[0] += t
            if u[1] is None: u[1] = (mats[mi].get('extras') or {}).get('three') or {}
            if 'COLOR_0' in pr.get('attributes', {}): u[2] = True
    return cell, use, None


class Binder:
    """r1c_cellmat2.py's branch choice and the generic master's colour, outside the engine"""
    def __init__(self):
        import r1c_cellmat2 as CM
        self.CM = CM
        exp = CM.EXPORT
        self.prev = os.path.abspath(os.path.join(exp, '..', '..', '..', 'public', 'textures', 'pbr'))
        HQ = json.load(open(os.path.join(exp, 'ue_families.json'))).get('hq') or {}
        try: HQM = json.load(open(HQ.get('manifest') or '/data0/projectnyc_aux/assets/hq/hq.json'))
        except Exception: HQM = {}
        self.HQ, self.HQM = HQ, HQM

        self.means = {}

    def tex_ok(self, t): return bool(self.CM.tex_path(t))

    def tex_mean(self, t):
        """a map's mean albedo (linear), None when it has no file"""
        p = self.CM.tex_path(t)
        if not p: return None
        if p not in self.means:
            try:
                from PIL import Image
                import numpy as np
                im = Image.open(p).convert('RGB'); im.thumbnail((64, 64))
                a = np.asarray(im, dtype=np.float64) / 255.0
                a = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
                self.means[p] = [float(x) for x in a.reshape(-1, 3).mean(0)]
            except Exception: self.means[p] = None
        return self.means[p]

    def classify(self, r):
        CM = self.CM
        tname = r.get('name') or ''
        tx = r.get('textures') or {}
        ud = r.get('userData') or {}
        ouv = r.get('obcUni') or {}
        if ud.get('isFacade'): return 'tilefac', None, True
        if r.get('type') == 'ShaderMaterial' and not tx: return 'hidden', None, True
        if CM.curtain2_params(tname, r) or (tname.startswith('tk:glass_') and tname[len('tk:glass_'):] in CM.TW_GLASS): return 'glass', None, True
        if tname.startswith(CM.FAMILY_NAMES): return 'family', None, True
        if ('uRefl' in ouv and 'uSunD' in ouv and not tx and r.get('type') == 'MeshStandardMaterial' and not (r.get('obcAttrs') or [])
                and 0.2 <= float(r.get('metalness') or 0) <= 0.35 and float(r.get('roughness') or 1) <= 0.4 and 'uSmP' not in ouv): return 'curtain', None, True
        if 'taAtlas' in ouv or 'vkPaint' in ouv or tname.startswith(('cp32l:water:', 'ar33sign:')) or CM.is_pool(r) or CM.is_veil(r): return 'special', None, True
        if tname in CM.KIT_GLASS or tname == 'glass': return 'glass', None, True
        # ---- the generic master
        P = {'map': self.tex_ok(tx.get('map'))}
        pb = ud.get('pbr') or {}
        sid = (self.HQ.get('pbr') or {}).get(pb.get('name')) if pb else None
        alias = None
        if pb and pb.get('name') and not sid and not os.path.exists(os.path.join(self.prev, pb['name'], 'preview.jpg')):
            al_ = CM.PBR_ALIAS.get(pb['name'])
            if al_ is None:
                for pre_, a_ in CM.PBR_ALIAS_PREFIX:
                    if pb['name'].startswith(pre_): al_ = a_; break
            sid = (self.HQ.get('pbr') or {}).get(al_) if al_ else None
            if sid and sid in self.HQM: alias = list((self.HQM[sid].get('albedo_mean') or [0.5, 0.5, 0.5])[:3])
        if not (P['map'] or sid or pb.get('name')):   # (WHITE06: r1c_cellmat2.white_flat, the building's pale flat colour on a masonry set)
            wf = CM.white_flat(dict(r, _bldg=1))
            sid = (self.HQ.get('pbr') or {}).get(wf) if wf else None
            if sid and sid in self.HQM: alias = list((self.HQM[sid].get('albedo_mean') or [0.5, 0.5, 0.5])[:3])
            else: sid = None
        if sid and sid in self.HQM: P['map'] = True
        elif pb and pb.get('name') and os.path.exists(os.path.join(self.prev, pb['name'], 'preview.jpg')): P['map'] = True
        col = list(r.get('color') or [1, 1, 1])[:3]
        if ud.get('fkBaseHex') and not tx.get('map'):
            h = ud['fkBaseHex'].lstrip('#'); col = srgb2lin([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
        tint = ((pb.get('opts') or {}).get('tint'))
        if isinstance(tint, str) and tint.startswith('#') and len(tint) == 7: col = srgb2lin([int(tint[1 + i:3 + i], 16) / 255.0 for i in (0, 2, 4)])
        pbn = pb.get('name') or ''
        if pbn and not P['map'] and min(col) > 0.9:
            g = 0.06 if 'epdm' in pbn or 'black' in pbn or 'tar' in pbn else 0.55 if 'membrane' in pbn or 'white' in pbn else 0.35
            col = [g, g, g]
        if P['map'] and not alias and not sid and self.tex_ok(tx.get('map')):   # (the record's own map: the colour drawn is colour x map mean)
            m_ = self.tex_mean(tx.get('map'))
            if m_: col = [col[i] * m_[i] for i in range(3)]
        elif P['map'] and sid and sid in self.HQM and not alias:
            m_ = list((self.HQM[sid].get('albedo_mean') or [0.5, 0.5, 0.5])[:3]); col = [col[i] * m_[i] for i in range(3)]
        if alias:
            l_ = lum(col); k_ = min(1.0, 0.48 / l_) if l_ > 0.48 else 1.0
            col = [min(4.0, col[i] * k_ / max(alias[i], 0.05)) * alias[i] for i in range(3)]   # (the albedo drawn: colour x map mean)
        if pbn.startswith('glass_'): return 'glass', None, True
        if r.get('type') == 'MeshBasicMaterial': return 'unlit', col, P['map']
        if any(r.get('emissive') or [0, 0, 0]) or tx.get('emissiveMap'): return 'emissive', col, P['map']
        fk = 'aFkTr' in (r.get('obcAttrs') or []) and not tname.startswith('fk:lv:')
        if fk: col = [min(c, 0.42) for c in col]   # (v9: the kit's tinted cladding held under 0.42 in the master)
        return ('generic_fk' if fk else 'generic'), col, P['map']


FARLIB = '/data0/projectnyc_aux/ue_cache/city_v2/farlib'


def far_pkg(fn):
    """{building id: [wall vertices, colour sum]} of one far package (its walls: |normal.y| < 0.5; the shells' albedo is
    the vertex colour, r1c_lodmat.py)"""
    import numpy as np
    out = {}
    try:
        f = open(os.path.join(FARLIB, fn), 'rb').read(); L = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + L])
        o = 20 + L; bl = struct.unpack('<I', f[o:o + 4])[0]; B = f[o + 8:o + 8 + bl]
    except Exception: return fn, out
    A, BV = J['accessors'], J['bufferViews']
    def arr(i):
        a = A[i]; bv = BV[a['bufferView']]
        dt = {5126: np.float32, 5121: np.uint8, 5123: np.uint16, 5125: np.uint32}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        if bv.get('byteStride') and bv['byteStride'] != n * np.dtype(dt).itemsize: return None
        x = np.frombuffer(B, dtype=dt, count=a['count'] * n, offset=bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, n).astype(np.float64)
        if a.get('normalized'): x /= float(np.iinfo(dt).max)
        return x
    for nd in J.get('nodes', []):
        ex = nd.get('extras') or {}
        if 'mesh' not in nd or ex.get('class') != BUILDING: continue
        names = ex.get('buildings') or []
        for pr in J['meshes'][nd['mesh']]['primitives']:
            at = pr.get('attributes', {})
            if 'COLOR_0' not in at or 'NORMAL' not in at: continue
            c, nrm = arr(at['COLOR_0']), arr(at['NORMAL'])
            if c is None or nrm is None: continue
            bk = arr(at['_bkey'])[:, 0].astype(np.int64) if '_bkey' in at else np.zeros(len(c), np.int64)
            w = np.abs(nrm[:, 1]) < 0.5
            for b in np.unique(bk[w]):
                m = w & (bk == b)
                nm = names[b] if 0 <= b < len(names) else f'{fn}:{b}'
                e = out.setdefault(nm, [0, [0.0, 0.0, 0.0], fn])
                e[0] += int(m.sum()); cs = c[m, :3].sum(0); e[1] = [e[1][i] + float(cs[i]) for i in range(3)]
    return fn, out


def far_audit(out_dir, jobs):
    fns = sorted(f for f in os.listdir(FARLIB) if f.endswith('.glb'))
    agg = {}
    with Pool(jobs) as P:
        for fn, o in P.imap_unordered(far_pkg, fns, chunksize=8):
            for nm, (n, cs, f_) in o.items():
                e = agg.setdefault(nm, [0, [0.0, 0.0, 0.0], set()])
                e[0] += n; e[1] = [e[1][i] + cs[i] for i in range(3)]; e[2].add(f_)
    rows = []
    for nm, (n, cs, fs) in agg.items():
        if not n: continue
        c = [x / n for x in cs]
        if lum(c) > WHITE_LUM: rows.append({'building': nm, 'lum': round(lum(c), 3), 'col': [round(x, 3) for x in c], 'verts': n, 'packages': sorted(fs)[:20]})
    rows.sort(key=lambda r: -r['verts'])
    S = {'packages': len(fns), 'buildings': len(agg), 'white_buildings': len(rows)}
    json.dump({'summary': S, 'rows': rows}, open(os.path.join(out_dir, 'far_audit.json'), 'w'), indent=0)
    print(json.dumps(S))
    for r in rows[:25]: print(f"  {r['verts']:>8}  {r['building']}  lum {r['lum']}  {r['col']}  {r['packages'][:3]}")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--far', action='store_true'); ap.add_argument('--out', required=True); ap.add_argument('--cells'); ap.add_argument('--jobs', type=int, default=32)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    if a.far: return far_audit(a.out, a.jobs)
    reg = json.load(open(REG))['cells']
    cells = sorted(reg)
    if a.cells:
        want = set(open(a.cells[1:]).read().split()) if a.cells.startswith('@') else set(a.cells.split(','))
        cells = [c for c in cells if c in want]
    agg, bad = {}, []
    with Pool(a.jobs) as P:
        for cell, use, err in P.imap_unordered(scan_cell, [(c, reg[c]['hash']) for c in cells], chunksize=64):
            if err: bad.append((cell, err)); continue
            for k, (t, r, vc) in use.items():
                A = agg.setdefault(k, {'tris': 0, 'cells': [], 'rec': r, 'vc': False})
                A['tris'] += t; A['cells'].append(cell); A['vc'] |= vc
    B = Binder()
    rows = []
    for k, A in agg.items():
        kind, col, tex = B.classify(A['rec'])
        if col is None: continue
        gen = kind in ('generic', 'generic_fk') and not A['vc'] and not A['rec'].get('transparent')   # (glass and decals: see-through)
        flat = gen and not tex and lum(col) > PALE_LUM   # (a pale surface without any pattern)
        white = gen and lum(col) > WHITE_LUM
        if flat or white:
            r = A['rec']
            rows.append({'key': k, 'name': r.get('name') or '', 'kind': kind, 'flat': flat, 'white': white, 'lum': round(lum(col), 3),
                         'col': [round(c, 3) for c in col], 'pbr': ((r.get('userData') or {}).get('pbr') or {}).get('name'),
                         'tris': A['tris'], 'ncells': len(A['cells']), 'cells': sorted(A['cells'])[:2000]})
    rows.sort(key=lambda x: -x['tris'])
    S = {'cells': len(cells), 'unreadable': len(bad), 'building_keys': len(agg), 'flagged_keys': len(rows),
         'flat_keys': sum(r['flat'] for r in rows), 'white_keys': sum(r['white'] for r in rows),
         'flat_white_keys': sum(r['flat'] and r['white'] for r in rows),
         'cells_touched': len({c for r in rows for c in r['cells']}), 'tris_flagged': sum(r['tris'] for r in rows)}
    json.dump({'summary': S, 'rows': rows, 'unreadable': bad[:50]}, open(os.path.join(a.out, 'white_audit.json'), 'w'), indent=0)
    print(json.dumps(S))
    by = {}
    for r in rows: by[(r['name'] or '(unnamed)', r['pbr'])] = by.get((r['name'] or '(unnamed)', r['pbr']), 0) + r['tris']
    for (n, p), t in sorted(by.items(), key=lambda kv: -kv[1])[:40]: print(f'  {t:>12,}  {n}  pbr={p}')


if __name__ == '__main__':
    main()
