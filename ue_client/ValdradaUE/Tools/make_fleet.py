"""The fleet library the client draws vehicles with: each kind's model (client/public/models/fleet24/<kind>.glb, the
web's own fleet) imported once as /Game/Client/Fleet/<kind>/SM_<kind>, its LOD0 only (the client's instanced meshes take the
engine's own levels of detail), from the importer's copies Tools/fleet_glb.mjs writes to Saved/fleet_glb (uncompressed,
PNG textures). Runs inside the editor:

    UnrealEditor-Cmd ue_client/ValdradaUE/ValdradaUE.uproject -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi

FLEET_SRC overrides the model folder; FLEET_KINDS (comma separated) imports only those kinds; FLEET_REIMPORT=1 replaces
kinds already imported, FLEET_REWHEEL=1 only their wheels. Each kind's wheels (<kind>__w<n>.glb, Tools/fleet_glb.mjs)
come in as SM_<kind>_w<n> with the body's material instances; Data/fleet.json gives the client each kind's mesh and its
wheels' meshes and hubs. The assets made are listed in Saved/fleet_assets.json (the client's own content: /Game/Client
only).
"""
import json
import os
import struct

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
SRC = os.environ.get('FLEET_SRC') or os.path.join(PROJECT, 'Saved', 'fleet_glb')
DEST = '/Game/Client/Fleet'
TMP = os.path.join(PROJECT, 'Saved', 'fleet_src')


def lod0_only(src, dst):
    """the model with its root and the LOD0 node only (the buffers kept whole: the unused views are left behind)"""
    b = open(src, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    J = json.loads(b[20:20 + n])
    rest = b[20 + n:]
    root = J['nodes'][J['scenes'][0]['nodes'][0]]
    keep = [c for c in root.get('children', []) if J['nodes'][c].get('name') == 'LOD0'] or root.get('children', [])[:1]
    root['children'] = keep
    # the root's extras hold the kind's metadata (lights, hubs); nothing in Unreal reads them
    js = json.dumps(J, separators=(',', ':')).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + len(rest)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(rest)
    return J['nodes'][J['scenes'][0]['nodes'][0]].get('extras') or {}


def wheels_of(kind, dest, meta):
    """the kind's wheel files imported as SM_<kind>_w<n>, each slot given the body's material instance of that name"""
    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    hubs = (meta or {}).get('hubs') or []
    body = eal.load_asset(f'{dest}/SM_{kind}')
    by_slot = {}
    if body:
        for m in body.get_editor_property('static_materials'):
            by_slot[str(m.get_editor_property('material_slot_name'))] = m.get_editor_property('material_interface')
    out = []
    for fn in sorted(f for f in os.listdir(SRC) if f.startswith(kind + '__w') and f.endswith('.glb')):
        n = int(fn[len(kind) + 3:-4])
        target = f'{dest}/SM_{kind}_w{n}'
        if os.environ.get('FLEET_REWHEEL') == '1' and eal.does_asset_exist(target):
            eal.delete_asset(target)
        if not eal.does_asset_exist(target):
            tmp = f'{dest}/_w{n}'
            t = unreal.AssetImportTask()
            t.set_editor_property('filename', os.path.join(SRC, fn))
            t.set_editor_property('destination_path', tmp)
            t.set_editor_property('automated', True)
            t.set_editor_property('replace_existing', True)
            t.set_editor_property('save', False)
            tools.import_asset_tasks([t])
            made = list(eal.list_assets(tmp, recursive=True, include_folder=False))
            sm = next((p for p in made if isinstance(eal.load_asset(p), unreal.StaticMesh)), None)
            if not sm:
                unreal.log_warning(f'[fleet] {kind}: wheel {n} imported no mesh')
                continue
            eal.rename_asset(sm.split('.')[0], target)
            w = eal.load_asset(target)
            mats = w.get_editor_property('static_materials')
            for m in mats:
                mi = by_slot.get(str(m.get_editor_property('material_slot_name')))
                if mi:
                    m.set_editor_property('material_interface', mi)
            w.set_editor_property('static_materials', mats)
            eal.save_asset(target, only_if_is_dirty=False)
            eal.delete_directory(tmp)
        h = hubs[n - 1] if n - 1 < len(hubs) else {}
        out.append({'n': n, 'mesh': target, 'p': h.get('p'), 'r': h.get('r'), 'w': h.get('w')})
    if out and not hubs:   # (a kept kind: the hubs from its body file's root)
        try:
            meta2 = lod0_only(os.path.join(SRC, kind + '.glb'), os.path.join(TMP, kind + '_meta.glb'))
            for w_ in out:
                h = (meta2.get('hubs') or [])[w_['n'] - 1]
                w_.update(p=h.get('p'), r=h.get('r'), w=h.get('w'))
        except Exception as e:
            unreal.log_warning(f'[fleet] {kind}: hubs not read ({e})')
    # each wheel's mesh centred on its hub and as tall as its tyre, or marked bad (fleet.json bad_wheels; release scripts
    # stop on any): a wheel cut in its node's normalised frame came in a third of its size and a metre off its hub
    for w_ in out:
        sm_ = eal.load_asset(w_['mesh'])
        r = w_.get('r')
        if not sm_ or not r or not w_.get('p'):
            w_['bad'] = 'no hub' if sm_ else 'no mesh'
            continue
        bb = sm_.get_bounding_box()
        c = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2]
        ext = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z]
        ax = ext.index(min(ext))   # (the axle: a dual rear wheel's pair sits off its hub along it, which spins it the same)
        d, tol = 200 * r, 100 * (0.15 * r + 0.03)
        if any(abs(c[i]) > tol or not (0.8 * d <= ext[i] <= 1.2 * d) for i in range(3) if i != ax):
            w_['bad'] = f'centre {[round(v, 1) for v in c]} cm, extents {[round(v, 1) for v in ext]} cm for a {d:.0f} cm tyre'
    return out


def main():
    os.makedirs(TMP, exist_ok=True)
    only = set(filter(None, (os.environ.get('FLEET_KINDS') or '').split(',')))
    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    out = {}
    reimport = os.environ.get('FLEET_REIMPORT') == '1'
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith('.glb') or '__w' in fn:
            continue
        kind = fn[:-4]
        if only and kind not in only:
            continue
        dest = f'{DEST}/{kind}'
        if eal.does_asset_exist(f'{dest}/SM_{kind}') and not reimport:
            out[kind] = {'mesh': f'{dest}/SM_{kind}', 'kept': True, 'wheels': wheels_of(kind, dest, None)}
            continue
        if reimport and eal.does_directory_exist(dest):
            eal.delete_directory(dest)
        tmp = os.path.join(TMP, fn)
        meta = lod0_only(os.path.join(SRC, fn), tmp)
        t = unreal.AssetImportTask()
        t.set_editor_property('filename', tmp)
        t.set_editor_property('destination_path', dest)
        t.set_editor_property('automated', True)
        t.set_editor_property('replace_existing', True)
        t.set_editor_property('save', False)
        tools.import_asset_tasks([t])
        made = [p for p in eal.list_assets(dest, recursive=True, include_folder=False)]
        meshes = [p for p in made if isinstance(eal.load_asset(p), unreal.StaticMesh)]
        rec = {'assets': made, 'size': meta.get('size')}
        if meshes:
            sm = eal.load_asset(meshes[0])
            target = f'{dest}/SM_{kind}'
            if meshes[0].split('.')[0] != target:
                eal.rename_asset(meshes[0].split('.')[0], target)
            sm = eal.load_asset(target)
            bb = sm.get_bounding_box()
            rec.update(mesh=target, bounds_cm=[bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z])
        else:
            rec['error'] = 'no static mesh imported'
        eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
        rec['wheels'] = wheels_of(kind, dest, meta)
        rec['assets'] = list(eal.list_assets(dest, recursive=True, include_folder=False))
        out[kind] = rec
        unreal.log(f'[fleet] {kind}: {rec.get("mesh") or rec.get("error")} {rec.get("bounds_cm")}')
    # the client draws a kind as one instanced mesh: without Nanite (the models' glass is translucent, which Nanite does
    # not draw) and with every material instance marked for instanced meshes (the importer's glTF masters are not, and a
    # cooked build cannot add the usage at run time)
    mel = unreal.MaterialEditingLibrary
    for kind, rec in out.items():
        dest = f'{DEST}/{kind}'
        sm = eal.load_asset(f'{dest}/SM_{kind}')
        if sm is None:
            continue
        for m_ in [sm] + [eal.load_asset(w['mesh']) for w in rec.get('wheels') or [] if eal.does_asset_exist(w['mesh'])]:
            ns = m_.get_editor_property('nanite_settings')
            if ns.get_editor_property('enabled'):
                ns.set_editor_property('enabled', False)
                m_.set_editor_property('nanite_settings', ns)
        n_mi = 0
        for p in eal.list_assets(dest, recursive=True, include_folder=False):
            a = eal.load_asset(p)
            if isinstance(a, unreal.MaterialInstanceConstant):
                mel.set_material_usage_override(a, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES, True, True)
                mel.update_material_instance(a)
                n_mi += 1
        eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
        rec.update(nanite=False, instanced_usage=n_mi)
        unreal.log(f'[fleet] {kind}: Nanite off, {n_mi} material instances for instanced meshes')
    json.dump(out, open(os.path.join(PROJECT, 'Saved', 'fleet_assets.json'), 'w'), indent=1)
    # the client's table: each kind's wheels, their meshes and hubs (the model's frame: x left, y up, z forward, metres)
    table = {k: {'mesh': r.get('mesh'), 'wheels': r.get('wheels') or []} for k, r in out.items() if r.get('mesh')}
    fj = os.path.join(PROJECT, 'Data', 'fleet.json')
    old = json.load(open(fj)).get('kinds', {}) if os.path.exists(fj) else {}
    old.update(table)
    bad = [f'{k} wheel {w["n"]}: {w["bad"]}' for k, r in old.items() for w in r.get('wheels') or [] if w.get('bad')]
    json.dump({'about': 'the client fleet\'s wheels (Tools/make_fleet.py): per kind its body mesh and each wheel\'s mesh (centred on its hub) and hub: p centre, r radius, n the web\'s wheel number (1, 2 front, steered)',
               'kinds': old, 'bad_wheels': bad}, open(fj, 'w'), indent=1)
    unreal.log(f'[fleet] {len(out)} kinds; list in Saved/fleet_assets.json')


main()
