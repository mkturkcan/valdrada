# HQ (AR34 UE round 3, 2026-10-07): the CC0 material sets for the Unreal target's layered materials (asphalt, sidewalk
# concrete, granite kerbs, the viaduct's painted steel and rust, the walls by class), downloaded at 4K into
# /data0/projectnyc_aux/assets/hq/<id>/ (never into git), with hq.json beside them: per set its source, licence, page,
# real size in metres, files (albedo, OpenGL normal, AO / roughness / metalness packed as R / G / B) and the albedo's
# mean in linear RGB (the tint that puts a set at a material's own colour). The table from family and pbrLib set to these
# sets is ue_families.json 'hq'.
#
#   source /data0/projectnyc_aux/env.sh
#   uv run --no-project --with pillow --with numpy python tools/assets/fetch_hq.py [--res 4k] [--only a,b] [--out <dir>]
#
# Every set here is CC0 (Poly Haven: https://polyhaven.com/license; ambientCG: https://docs.ambientcg.com/license/). A set
# that is already complete is not downloaded again.
import argparse, json, os, sys, time, urllib.request
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
# (id, source, what it stands for)
SETS = [
    ('asphalt_02', 'polyhaven', 'street asphalt'),
    ('concrete_pavement', 'polyhaven', 'sidewalk concrete flags'),
    ('granite_wall', 'polyhaven', 'granite kerbs, granite walls'),
    ('green_metal_rust', 'polyhaven', 'the viaduct paint over steel'),
    ('rust_coarse_01', 'polyhaven', 'the viaduct rust'),
    ('red_brick', 'polyhaven', 'red brick walls'),
    ('brick_wall_10', 'polyhaven', 'dark brown brick walls'),
    ('brown_brick_02', 'polyhaven', 'tan and buff brick walls'),
    ('painted_brick', 'polyhaven', 'painted brick walls'),
    ('large_sandstone_blocks', 'polyhaven', 'limestone, cast stone, brownstone'),
    ('concrete_wall_008', 'polyhaven', 'cast-in-place concrete walls'),
    ('preconcrete_wall_001', 'polyhaven', 'precast concrete panels'),
    ('white_stucco', 'polyhaven', 'stucco'),
    # R9-HQ (UE track, 2026-10-08): the parks and Times Square (rounds 9-10)
    ('lichen_rock', 'polyhaven', 'Central Park schist outcrops and boulders, grey with lichen'),
    ('dark_rock_02', 'polyhaven', 'the schist\'s dark foliated faces, wet rock at the water'),
    ('castle_wall_slates', 'polyhaven', 'schist rubble masonry: Belvedere Castle, Gapstow Bridge, the park walls'),
    ('gravel_floor', 'polyhaven', 'pale crushed gravel: Bryant Park, the park paths'),
    ('hexagonal_concrete_paving', 'polyhaven', 'Central Park hexagonal pavers'),
    ('marble_01', 'polyhaven', 'white marble ashlar: the NYPL'),
    ('metal_plate_02', 'polyhaven', 'cast and wrought iron: railings, lamp posts, fences, Bow Bridge'),
    ('Grass004', 'ambientcg', 'lawns: Sheep Meadow, the Great Lawn, Bryant Park'),
    # R9-HQ end
    # BRIDGE (2026-10-23): the bridges' painted steel (pbrLib metal_painted: the GWB, the Harlem and East River bridges),
    # its paint's scratches, roughness and normal; the albedo desaturated (GREY) so the bridge's own tint sets the colour
    ('PaintedMetal002', 'ambientcg', 'painted steel: the bridges (metal_painted)'),
]
GREY = {'PaintedMetal002'}   # (BRIDGE: sets whose albedo is used as luminance only, alb_grey)
LICENCE = {'polyhaven': 'CC0 1.0 (https://polyhaven.com/license)', 'ambientcg': 'CC0 1.0 (https://docs.ambientcg.com/license/)'}   # (R9-HQ: ambientCG)
UA = {'User-Agent': 'valdrada-hq-fetch/1.0'}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def download(url, dst):
    tmp = dst + '.part'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(tmp, 'wb') as f:
        while True:
            b = r.read(1 << 20)
            if not b: break
            f.write(b)
    os.replace(tmp, dst)


def pick(files, key, res):
    """a map's jpg (else png) at res, else the nearest lower resolution."""
    m = files.get(key) or {}
    for r in [res] + [x for x in ('8k', '4k', '2k', '1k') if x != res]:
        if r in m:
            for fmt in ('jpg', 'png'):
                if fmt in m[r]: return m[r][fmt]['url'], r
    return None, None


def mean_linear(path):
    im = Image.open(path).convert('RGB')
    im.thumbnail((256, 256))
    a = np.asarray(im, np.float32) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    return [round(float(v), 4) for v in lin.reshape(-1, 3).mean(0)]


def fetch_polyhaven(sid, out, res):
    info = get_json(f'https://api.polyhaven.com/info/{sid}')
    files = get_json(f'https://api.polyhaven.com/files/{sid}')
    d = os.path.join(out, sid); os.makedirs(d, exist_ok=True)
    rec = {'source': 'polyhaven', 'licence': LICENCE['polyhaven'], 'page': f'https://polyhaven.com/a/{sid}',
           'size_m': [round(float(v) / 1000.0, 3) for v in (info.get('dimensions') or [2000, 2000])[:2]], 'files': {}, 'urls': {}}
    try:   # MESH11: the height map too
        rec['files']['disp'], rec['urls']['disp'] = fetch_disp(sid, out)
    except Exception: pass
    for key, name in (('Diffuse', 'alb'), ('nor_gl', 'nrm'), ('arm', 'arm')):
        url, r = pick(files, key, res)
        if not url: continue
        dst = os.path.join(d, f'{sid}_{name}_{r}{os.path.splitext(url)[1]}')
        if not os.path.exists(dst): download(url, dst)
        rec['files'][name] = dst; rec['urls'][name] = url
    if 'arm' not in rec['files']:
        # no packed map: AO, roughness (and no metalness) packed here as R, G, B
        parts = {}
        for key in ('AO', 'Rough'):
            url, r = pick(files, key, res)
            if url:
                dst = os.path.join(d, f'{sid}_{key.lower()}_{r}{os.path.splitext(url)[1]}')
                if not os.path.exists(dst): download(url, dst)
                parts[key] = dst; rec['urls'][key.lower()] = url
        if 'Rough' in parts:
            R = Image.open(parts['Rough']).convert('L')
            A = Image.open(parts['AO']).convert('L').resize(R.size) if 'AO' in parts else Image.new('L', R.size, 255)
            dst = os.path.join(d, f'{sid}_arm_{res}.jpg')
            Image.merge('RGB', (A, R, Image.new('L', R.size, 0))).save(dst, quality=95)
            rec['files']['arm'] = dst
    if 'alb' in rec['files']: rec['albedo_mean'] = mean_linear(rec['files']['alb'])
    return rec


# R9-HQ: an ambientCG set (CC0): the zip at res, its colour, OpenGL normal, AO and roughness, AO / roughness packed as in
# fetch_polyhaven; the real size from the asset's dimensions (cm)
def fetch_ambientcg(sid, out, res):
    import zipfile
    info = get_json(f'https://ambientcg.com/api/v2/full_json?id={sid}&include=downloadData,dimensionsData')['foundAssets'][0]
    want = f'{res.upper()}-JPG'
    dls = info['downloadFolders']['default']['downloadFiletypeCategories']['zip']['downloads']
    dl = next((x for x in dls if x['attribute'] == want), None) or next(x for x in dls if x['attribute'].endswith('-JPG'))
    d = os.path.join(out, sid); os.makedirs(d, exist_ok=True)
    zp = os.path.join(d, dl['fileName'])
    if not os.path.exists(zp): download(dl['downloadLink'], zp)
    r = dl['attribute'].split('-')[0].lower()
    dims = [float(info.get('dimensionX') or 0), float(info.get('dimensionY') or 0)]
    rec = {'source': 'ambientcg', 'licence': LICENCE['ambientcg'], 'page': f'https://ambientcg.com/a/{sid}',
           'size_m': [round(v / 100.0, 3) for v in dims] if all(dims) else [2.0, 2.0], 'files': {}, 'urls': {'zip': dl['downloadLink']}}
    with zipfile.ZipFile(zp) as z:
        names = z.namelist()
        def ext(suffix, name):
            src = next((n for n in names if n.endswith(f'_{suffix}.jpg') or n.endswith(f'_{suffix}.png')), None)
            if src is None: return None
            dst = os.path.join(d, f'{sid}_{name}_{r}{os.path.splitext(src)[1]}')
            if not os.path.exists(dst):
                with z.open(src) as f_, open(dst + '.part', 'wb') as g_: g_.write(f_.read())
                os.replace(dst + '.part', dst)
            return dst
        alb, nrm, ao, rough = ext('Color', 'alb'), ext('NormalGL', 'nrm'), ext('AmbientOcclusion', 'ao'), ext('Roughness', 'rough')
        disp = ext('Displacement', 'disp')   # MESH11: the height map
        if disp: rec['files']['disp'] = disp
    if alb: rec['files']['alb'] = alb
    if nrm: rec['files']['nrm'] = nrm
    if rough:
        R = Image.open(rough).convert('L')
        A = Image.open(ao).convert('L').resize(R.size) if ao else Image.new('L', R.size, 255)
        dst = os.path.join(d, f'{sid}_arm_{r}.jpg')
        Image.merge('RGB', (A, R, Image.new('L', R.size, 0))).save(dst, quality=95)
        rec['files']['arm'] = dst
    if alb: rec['albedo_mean'] = mean_linear(alb)
    return rec
# R9-HQ end


# MESH11 (UE track, 2026-10-08): a Poly Haven set's height map (Displacement, 2k PNG, 16-bit), beside its other maps
def fetch_disp(sid, out, res='2k'):
    files = get_json(f'https://api.polyhaven.com/files/{sid}')
    m = (files.get('Displacement') or {}).get(res) or {}
    url = (m.get('png') or m.get('jpg') or {}).get('url')
    if not url: raise RuntimeError('no Displacement map')
    d = os.path.join(out, sid); os.makedirs(d, exist_ok=True)
    dst = os.path.join(d, f'{sid}_disp_{res}{os.path.splitext(url)[1]}')
    if not os.path.exists(dst): download(url, dst)
    return dst, url
# MESH11 end


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', default='4k'); ap.add_argument('--only'); ap.add_argument('--out', default='/data0/projectnyc_aux/assets/hq')
    A = ap.parse_args()
    os.makedirs(A.out, exist_ok=True)
    jp = os.path.join(A.out, 'hq.json')
    man = json.load(open(jp)) if os.path.exists(jp) else {}
    only = set(A.only.split(',')) if A.only else None
    for sid, src, what in SETS:
        if only and sid not in only: continue
        if sid in man and all(os.path.exists(f) for f in man[sid].get('files', {}).values()) and len(man[sid].get('files', {})) >= 3:
            # MESH11 (UE track, 2026-10-08): a complete set without its height map takes that alone (Poly Haven's
            # Displacement at 2k, as a 16-bit PNG: the Nanite displacement's source)
            if src == 'polyhaven' and 'disp' not in man[sid]['files']:
                try:
                    man[sid]['files']['disp'], man[sid]['urls']['disp'] = fetch_disp(sid, A.out)
                    json.dump(man, open(jp, 'w'), indent=1); print(f'HQ {sid}: height map added')
                except Exception as e: print(f'HQ {sid}: height map FAILED {e}')
                continue
            print(f'HQ {sid}: have it'); continue
        t0 = time.time()
        try:
            rec = fetch_polyhaven(sid, A.out, A.res) if src == 'polyhaven' else fetch_ambientcg(sid, A.out, A.res) if src == 'ambientcg' else None   # (R9-HQ)
        except Exception as e:
            print(f'HQ {sid}: FAILED {e}'); continue
        if sid in GREY and rec['files'].get('alb'):   # (BRIDGE: the albedo's luminance alone; the tint gives the paint its colour)
            g_ = os.path.splitext(rec['files']['alb'])[0] + '_grey.jpg'
            a_ = np.asarray(Image.open(rec['files']['alb']).convert('L'), np.float32) / 255.0
            l_ = np.where(a_ <= 0.04045, a_ / 12.92, ((a_ + 0.055) / 1.055) ** 2.4)
            l_ = np.clip(l_ * (0.8 / max(float(l_.mean()), 1e-3)), 0, 1)   # (mean 0.8 linear: the tint times it is the paint)
            s_ = np.where(l_ <= 0.0031308, l_ * 12.92, 1.055 * l_ ** (1 / 2.4) - 0.055)
            Image.fromarray((s_ * 255 + 0.5).astype(np.uint8), 'L').convert('RGB').save(g_, quality=95)
            rec['files']['alb'] = g_; rec['albedo_mean'] = mean_linear(g_)
        rec['use'] = what
        man[sid] = rec
        json.dump(man, open(jp, 'w'), indent=1)
        print(f'HQ {sid}: {len(rec["files"])} maps, {rec["size_m"]} m, mean {rec.get("albedo_mean")}, {time.time() - t0:.0f} s')
    print('HQ_DONE ' + json.dumps({'sets': len(man), 'out': jp}))


if __name__ == '__main__':
    sys.exit(main())
