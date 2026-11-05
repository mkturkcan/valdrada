"""The crowd's photoreal walkers in the client (/Game/Client/Crowd): every texture layer the variants dress their bodies in
(the crowd's KTX2 arrays unpacked once, client/tools/ar34/export/usd_peds.py's cache), a material instance per layer and
kind over two masters (M_client_ped: albedo, normal, occlusion and roughness; M_client_ped_hair: masked, two-sided), and
each body from Tools/crowd_glb.mjs's skinned glTF as a skeletal mesh with its walk, idle and run animations. Writes
Data/crowd.json, the table the client reads: per variant its body's mesh, animations and each slot's material. Runs inside
the editor:

    UnrealEditor-Cmd ue_client/ValdradaUE/ValdradaUE.uproject -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi

CROWD_GLB (Tools/crowd_glb.mjs's output folder), CROWD_TEX (the unpacked layers: <dir>/peds24/{albedo,normal,orm,hair}_LLL.png);
CROWD_REIMPORT=1 imports the bodies again over the ones already imported.
"""
import json
import os

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(PROJECT, '..', '..'))
GLB = os.environ.get('CROWD_GLB') or os.path.join(PROJECT, 'Saved', 'crowd_glb')
TEX = os.path.join(os.environ.get('CROWD_TEX') or '/data0/projectnyc_aux/tmp/bx/peds/tex', 'peds24')
MANIFEST = os.environ.get('CROWD_MANIFEST') or os.path.join(REPO, 'client', 'public', 'models', 'peds24', 'manifest.json')
DEST = '/Game/Client/Crowd'
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()


def log(*a):
    unreal.log('[crowd] ' + ' '.join(str(x) for x in a))


def import_texture(png, dest, name, kind):
    path = f'{dest}/{name}'
    if eal.does_asset_exist(path):
        return path
    t = unreal.AssetImportTask()
    t.set_editor_property('filename', png)
    t.set_editor_property('destination_path', dest)
    t.set_editor_property('destination_name', name)
    t.set_editor_property('automated', True)
    t.set_editor_property('replace_existing', True)
    t.set_editor_property('save', False)
    tools.import_asset_tasks([t])
    tex = eal.load_asset(path)
    if tex is None:
        raise RuntimeError(f'texture import failed: {png}')
    if kind == 'normal':
        tex.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_NORMALMAP)
        tex.set_editor_property('srgb', False)
    elif kind == 'orm':
        tex.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_MASKS)
        tex.set_editor_property('srgb', False)
    eal.save_asset(path, only_if_is_dirty=False)
    return path


def master(name, hair, dflt):
    path = f'{DEST}/{name}'
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = tools.create_asset(name, DEST, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('used_with_skeletal_mesh', True)
    alb = mel.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameter2D, -700, -200)
    alb.set_editor_property('parameter_name', 'Albedo')
    alb.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
    # (every texture parameter's default of its sampler's kind, layer 0's: with none the engine's DefaultTexture, a colour
    # texture, fails the Normal and Masks samplers' check, the master does not compile and every walker drew the default
    # material, flat grey, in the editor and the cooked client alike)
    alb.set_editor_property('texture', eal.load_asset(dflt['hair' if hair else 'albedo']))
    mel.connect_material_property(alb, 'RGB', unreal.MaterialProperty.MP_BASE_COLOR)
    if hair:
        m.set_editor_property('blend_mode', unreal.BlendMode.BLEND_MASKED)
        m.set_editor_property('two_sided', True)
        m.set_editor_property('opacity_mask_clip_value', 0.35)
        mel.connect_material_property(alb, 'A', unreal.MaterialProperty.MP_OPACITY_MASK)
        r = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -300, 100)
        r.set_editor_property('r', 0.75)
        mel.connect_material_property(r, '', unreal.MaterialProperty.MP_ROUGHNESS)
    else:
        nrm = mel.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameter2D, -700, 50)
        nrm.set_editor_property('parameter_name', 'Normal')
        nrm.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
        nrm.set_editor_property('texture', eal.load_asset(dflt['normal']))
        mel.connect_material_property(nrm, 'RGB', unreal.MaterialProperty.MP_NORMAL)
        orm = mel.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameter2D, -700, 300)
        orm.set_editor_property('parameter_name', 'ORM')
        orm.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
        orm.set_editor_property('texture', eal.load_asset(dflt['orm']))
        mel.connect_material_property(orm, 'R', unreal.MaterialProperty.MP_AMBIENT_OCCLUSION)
        # (roughness from the map, or a fixed value: the eyes' wet 0.08)
        fixed = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -500, 450)
        fixed.set_editor_property('parameter_name', 'RoughFixed')
        fixed.set_editor_property('default_value', 0.5)
        w = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -500, 550)
        w.set_editor_property('parameter_name', 'RoughFixedWeight')
        w.set_editor_property('default_value', 0.0)
        lerp = mel.create_material_expression(m, unreal.MaterialExpressionLinearInterpolate, -250, 400)
        mel.connect_material_expressions(orm, 'G', lerp, 'A')
        mel.connect_material_expressions(fixed, '', lerp, 'B')
        mel.connect_material_expressions(w, '', lerp, 'Alpha')
        mel.connect_material_property(lerp, '', unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    return m


def main():
    man = json.load(open(MANIFEST))
    summary = json.load(open(os.path.join(GLB, 'crowd_glb.json')))['bodies']
    # the layers each variant's slots take (usd_peds.py face_layers: a slot under 100 reads the variant's table, the UDIM
    # tile adds to an opaque slot's layer; 100 and over is a fixed layer)
    def layer_of(V, kind, slot, tile):
        L = slot - 100 if slot >= 100 else max(0, V['layers'][slot] if slot < len(V['layers']) and V['layers'][slot] is not None else 0)
        return L + (tile if kind == 'opaque' else 0)
    need = {}
    for V in man['variants']:
        B = summary.get(V['body'])
        if not B:
            continue
        for s in B['slots']:
            kind, slot, tile, c = s.split('_')
            need[(kind, layer_of(V, kind, int(slot), int(tile)), int(c[1:]))] = 1
    log(f'{len(need)} (kind, layer, class) materials for {len(man["variants"])} variants')
    dflt = {k: import_texture(os.path.join(TEX, f'{k}_000.png'), f'{DEST}/T', f'T_{k}_000', 'albedo' if k in ('albedo', 'hair') else k)
            for k in ('albedo', 'normal', 'orm', 'hair')}
    m_op, m_hair = master('M_client_ped', False, dflt), master('M_client_ped_hair', True, dflt)
    mats = {}
    for (kind, L, c) in sorted(need):
        name = f'MI_ped_{kind}_L{L:03d}_c{c}'
        path = f'{DEST}/M/{name}'
        if not eal.does_asset_exist(path):
            mi = tools.create_asset(name, f'{DEST}/M', unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
            mi.set_editor_property('parent', m_hair if kind == 'hair' else m_op)
            if kind == 'hair':
                mel.set_material_instance_texture_parameter_value(mi, 'Albedo', eal.load_asset(import_texture(os.path.join(TEX, f'hair_{L:03d}.png'), f'{DEST}/T', f'T_hair_{L:03d}', 'albedo')))
            else:
                mel.set_material_instance_texture_parameter_value(mi, 'Albedo', eal.load_asset(import_texture(os.path.join(TEX, f'albedo_{L:03d}.png'), f'{DEST}/T', f'T_albedo_{L:03d}', 'albedo')))
                mel.set_material_instance_texture_parameter_value(mi, 'Normal', eal.load_asset(import_texture(os.path.join(TEX, f'normal_{L:03d}.png'), f'{DEST}/T', f'T_normal_{L:03d}', 'normal')))
                mel.set_material_instance_texture_parameter_value(mi, 'ORM', eal.load_asset(import_texture(os.path.join(TEX, f'orm_{L:03d}.png'), f'{DEST}/T', f'T_orm_{L:03d}', 'orm')))
                if c == 2:   # (the eyes: wet)
                    mel.set_material_instance_scalar_parameter_value(mi, 'RoughFixed', 0.08)
                    mel.set_material_instance_scalar_parameter_value(mi, 'RoughFixedWeight', 1.0)
            mel.update_material_instance(mi)
            eal.save_asset(path, only_if_is_dirty=False)
        else:
            # (the masters are made anew each run: an instance kept from an earlier one is pointed at them again)
            mi = eal.load_asset(path)
            mi.set_editor_property('parent', m_hair if kind == 'hair' else m_op)
            mel.update_material_instance(mi)
            eal.save_asset(path, only_if_is_dirty=False)
        mats[(kind, L, c)] = path
    # the bodies
    bodies = {}
    for name, B in sorted(summary.items()):
        dest = f'{DEST}/{name}'
        src = os.path.join(GLB, name + '.glb')
        if os.environ.get('CROWD_REIMPORT') == '1' and eal.does_directory_exist(dest):
            eal.delete_directory(dest)
        if not eal.does_directory_exist(dest) or not any(isinstance(eal.load_asset(p), unreal.SkeletalMesh) for p in eal.list_assets(dest, recursive=True, include_folder=False)):
            t = unreal.AssetImportTask()
            t.set_editor_property('filename', src)
            t.set_editor_property('destination_path', dest)
            t.set_editor_property('automated', True)
            t.set_editor_property('replace_existing', True)
            t.set_editor_property('save', False)
            tools.import_asset_tasks([t])
            eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
        made = list(eal.list_assets(dest, recursive=True, include_folder=False))
        rec = {'mesh': None, 'anims': {}, 'skeleton': None}
        for p in made:
            a = eal.load_asset(p)
            q = p.split('.')[0]
            if isinstance(a, unreal.SkeletalMesh):
                rec['mesh'] = q
                bb = a.get_bounds()
                rec['bounds_cm'] = [round(bb.origin.x - bb.box_extent.x, 1), round(bb.origin.y - bb.box_extent.y, 1), round(bb.origin.z - bb.box_extent.z, 1),
                                    round(bb.origin.x + bb.box_extent.x, 1), round(bb.origin.y + bb.box_extent.y, 1), round(bb.origin.z + bb.box_extent.z, 1)]
                rec['slots'] = [str(m.get_editor_property('material_slot_name')) for m in a.get_editor_property('materials')]
            elif isinstance(a, unreal.AnimSequence):
                role = next((r for r in ('walk', 'idle', 'run') if q.lower().endswith(r) or f'_{r}' in q.lower().split('/')[-1]), None)
                if role:
                    rec['anims'][role] = {'path': q, **B['anims'].get(role, {})}
            elif isinstance(a, unreal.Skeleton):
                rec['skeleton'] = q
        rec.update(height=B['height'], hips=B['hips'], skeleton_name=B['skeleton'])
        bodies[name] = rec
        log(name, rec['mesh'], sorted(rec['anims']), rec.get('bounds_cm'), len(rec.get('slots') or []), 'slots')
    # the table
    ref_hips = {}
    for s in man['skeletons']:
        adults = [bodies[n]['hips'] for n, b in man['bodies'].items() if b['skeleton'] == s and n in bodies and b['height'] > 1.5]
        ref_hips[s] = adults[0] if adults else 1.0
    variants = []
    for V in man['variants']:
        b = bodies.get(V['body'])
        if not b or not b['mesh']:
            continue
        slots = {}
        for s in summary[V['body']]['slots']:
            kind, slot, tile, c = s.split('_')
            slots['p_' + s] = mats[(kind, layer_of(V, kind, int(slot), int(tile)), int(c[1:]))]
        variants.append({'name': V['name'], 'body': V['body'], 'scale': V.get('scale') or 1, 'age': V.get('age'), 'gender': V.get('gender'),
                         'mesh': b['mesh'], 'anims': b['anims'], 'slots': slots, 'hips': b['hips'], 'height': b['height'],
                         'ref_hips': ref_hips.get(b['skeleton_name'], 1.0)})
    out = {'about': 'the client\'s photoreal walkers (Tools/make_crowd.py): per variant its body\'s skeletal mesh, animations (clip seconds, natural speed m/s, the body\'s and the skeleton\'s reference hips) and each material slot\'s instance',
           'variants': variants, 'bodies': bodies}
    json.dump(out, open(os.path.join(PROJECT, 'Data', 'crowd.json'), 'w'), indent=1)
    log(f'{len(variants)} variants, {len(bodies)} bodies, {len(mats)} materials -> Data/crowd.json')


main()
