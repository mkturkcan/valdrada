"""The train cars the client draws (/Game/Client/Trains): each kind (r62a, m7a, m8) from Tools/trains_glb.mjs as one static
mesh, its material classes on M_client_train (the vertex colours, which carry the liveries and the weathering, times a
colour, with each class's metalness and roughness as the page's materials have them: client/src/city/trains/mats.js).
Writes Data/trains.json. Runs inside the editor:

    UnrealEditor-Cmd ue_client/ValdradaUE/ValdradaUE.uproject -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi

TRAINS_GLB: Tools/trains_glb.mjs's output folder.
"""
import json
import os

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
SRC = os.environ.get('TRAINS_GLB') or os.path.join(PROJECT, 'Saved', 'trains_glb')
DEST = '/Game/Client/Trains'
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
# (sRGB colour, metalness, roughness) per class, the page's (mats.js); glass opaque and dark, as the page's far glazing
CLASSES = {'stainless': ((154, 158, 163), 0.8, 0.42), 'paint': ((255, 255, 255), 0.0, 0.5), 'dark': ((255, 255, 255), 0.35, 0.74),
           'glass': ((11, 14, 17), 0.0, 0.05), 'interior': ((255, 255, 255), 0.0, 0.7)}


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def master():
    path = f'{DEST}/M_client_train'
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = tools.create_asset('M_client_train', DEST, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('used_with_instanced_static_meshes', True)
    vc = mel.create_material_expression(m, unreal.MaterialExpressionVertexColor, -700, -100)
    col = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -700, 100)
    col.set_editor_property('parameter_name', 'Color')
    col.set_editor_property('default_value', unreal.LinearColor(1, 1, 1, 1))
    mul = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -450, 0)
    mel.connect_material_expressions(vc, '', mul, 'A')
    mel.connect_material_expressions(col, '', mul, 'B')
    mel.connect_material_property(mul, '', unreal.MaterialProperty.MP_BASE_COLOR)
    for name, prop, y, dv in (('Metallic', unreal.MaterialProperty.MP_METALLIC, 250, 0.0), ('Roughness', unreal.MaterialProperty.MP_ROUGHNESS, 350, 0.6)):
        p = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -450, y)
        p.set_editor_property('parameter_name', name)
        p.set_editor_property('default_value', dv)
        mel.connect_material_property(p, '', prop)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    return m


def main():
    m = master()
    mats = {}
    for k, (c, metal, rough) in CLASSES.items():
        path = f'{DEST}/MI_train_{k}'
        if eal.does_asset_exist(path):
            eal.delete_asset(path)
        mi = tools.create_asset(f'MI_train_{k}', DEST, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mi.set_editor_property('parent', m)
        mel.set_material_instance_vector_parameter_value(mi, 'Color', unreal.LinearColor(lin(c[0]), lin(c[1]), lin(c[2]), 1))
        mel.set_material_instance_scalar_parameter_value(mi, 'Metallic', metal)
        mel.set_material_instance_scalar_parameter_value(mi, 'Roughness', rough)
        mel.update_material_instance(mi)
        eal.save_asset(path, only_if_is_dirty=False)
        mats[k] = mi
    out = {}
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith('.glb'):
            continue
        kind = fn[:-4]
        dest = f'{DEST}/{kind}'
        if eal.does_directory_exist(dest):
            eal.delete_directory(dest)
        t = unreal.AssetImportTask()
        t.set_editor_property('filename', os.path.join(SRC, fn))
        t.set_editor_property('destination_path', dest)
        t.set_editor_property('automated', True)
        t.set_editor_property('replace_existing', True)
        t.set_editor_property('save', False)
        tools.import_asset_tasks([t])
        made = list(eal.list_assets(dest, recursive=True, include_folder=False))
        sm = next((p for p in made if isinstance(eal.load_asset(p), unreal.StaticMesh)), None)
        if not sm:
            unreal.log_warning(f'[trains] {kind}: no static mesh imported')
            continue
        target = f'{dest}/SM_{kind}'
        if sm.split('.')[0] != target:
            eal.rename_asset(sm.split('.')[0], target)
        mesh = eal.load_asset(target)
        sms = mesh.get_editor_property('static_materials')
        for s in sms:
            cls = str(s.get_editor_property('material_slot_name')).replace('t_', '', 1)
            if cls in mats:
                s.set_editor_property('material_interface', mats[cls])
        mesh.set_editor_property('static_materials', sms)
        ns = mesh.get_editor_property('nanite_settings')
        ns.set_editor_property('enabled', False)
        mesh.set_editor_property('nanite_settings', ns)
        eal.save_asset(target, only_if_is_dirty=False)
        for p in made:   # (the importer's own material instances and textures: unused)
            q = p.split('.')[0]
            if q != target and eal.does_asset_exist(q) and not isinstance(eal.load_asset(q), unreal.StaticMesh):
                eal.delete_asset(q)
        bb = mesh.get_bounding_box()
        out[kind] = {'mesh': target, 'bounds_cm': [round(v, 1) for v in (bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z)]}
        unreal.log(f'[trains] {kind}: {target} {out[kind]["bounds_cm"]}')
    json.dump({'about': 'the client\'s train cars (Tools/make_trains.py): per kind its mesh, the car\'s centre at rail height, +X its front',
               'kinds': out}, open(os.path.join(PROJECT, 'Data', 'trains.json'), 'w'), indent=1)


main()
