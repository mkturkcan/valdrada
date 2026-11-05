"""The client's own materials (/Game/Client/Materials). M_client_semantic: a post-process material after the tonemapper
that writes each pixel's custom stencil (the semantic class id the client gives every drawn component) as its colour,
stencil / 255 in every channel, so an 8-bit capture reads the class id back exactly. Runs inside the editor:

    UnrealEditor-Cmd ue_client/ValdradaUE/ValdradaUE.uproject -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi
"""
import unreal

DEST = '/Game/Client/Materials'


def semantic():
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    path = f'{DEST}/M_client_semantic'
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset('M_client_semantic', DEST, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('material_domain', unreal.MaterialDomain.MD_POST_PROCESS)
    m.set_editor_property('blendable_location', unreal.BlendableLocation.BL_SCENE_COLOR_AFTER_TONEMAPPING)
    st = mel.create_material_expression(m, unreal.MaterialExpressionSceneTexture, -600, 0)
    st.set_editor_property('scene_texture_id', unreal.SceneTextureId.PPI_CUSTOM_STENCIL)
    mask = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -400, 0)
    mask.set_editor_property('r', True)
    mel.connect_material_expressions(st, 'Color', mask, '')
    div = mel.create_material_expression(m, unreal.MaterialExpressionDivide, -200, 0)
    div.set_editor_property('const_b', 255.0)
    mel.connect_material_expressions(mask, '', div, 'A')
    mel.connect_material_property(div, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    unreal.log(f'[client materials] {path} saved')


def instance_id():
    """M_client_id: the road users' copies in the instance capture. Unlit, its 24-bit code as colour, byte / 255 per channel:
    an instanced copy's code from its per-instance data (three floats), a single component's from its `Code` parameter."""
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    path = f'{DEST}/M_client_id'
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset('M_client_id', DEST, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_UNLIT)
    for flag in ('used_with_instanced_static_meshes', 'used_with_skeletal_mesh'):
        m.set_editor_property(flag, True)
    d = []
    for i in range(3):
        e = mel.create_material_expression(m, unreal.MaterialExpressionPerInstanceCustomData, -800, -200 + 120 * i)
        e.set_editor_property('data_index', i)
        e.set_editor_property('const_default_value', 0.0)
        d.append(e)
    rg = mel.create_material_expression(m, unreal.MaterialExpressionAppendVector, -600, -140)
    mel.connect_material_expressions(d[0], '', rg, 'A')
    mel.connect_material_expressions(d[1], '', rg, 'B')
    rgb = mel.create_material_expression(m, unreal.MaterialExpressionAppendVector, -450, -100)
    mel.connect_material_expressions(rg, '', rgb, 'A')
    mel.connect_material_expressions(d[2], '', rgb, 'B')
    code = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -600, 120)
    code.set_editor_property('parameter_name', 'Code')
    code.set_editor_property('default_value', unreal.LinearColor(0, 0, 0, 0))
    mask = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -450, 120)
    for c in ('r', 'g', 'b'):
        mask.set_editor_property(c, True)
    mel.connect_material_expressions(code, '', mask, '')
    add = mel.create_material_expression(m, unreal.MaterialExpressionAdd, -250, 0)
    mel.connect_material_expressions(rgb, '', add, 'A')
    mel.connect_material_expressions(mask, '', add, 'B')
    mel.connect_material_property(add, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    unreal.log(f'[client materials] {path} saved')


def glass():
    """M_client_glass: the fleet's windows, dark and glossy and opaque (the browser draws them at 0.62 over a lit cabin;
    the models' translucent glass showed the cabins through the roofs in Unreal)"""
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    path = f'{DEST}/M_client_glass'
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset('M_client_glass', DEST, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('used_with_instanced_static_meshes', True)
    for prop, val, y in ((unreal.MaterialProperty.MP_BASE_COLOR, (0.012, 0.015, 0.018), -100), (unreal.MaterialProperty.MP_ROUGHNESS, 0.04, 100),
                         (unreal.MaterialProperty.MP_SPECULAR, 0.6, 200), (unreal.MaterialProperty.MP_METALLIC, 0.0, 300)):
        if isinstance(val, tuple):
            e = mel.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -400, y)
            e.set_editor_property('constant', unreal.LinearColor(val[0], val[1], val[2], 1))
        else:
            e = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -400, y)
            e.set_editor_property('r', val)
        mel.connect_material_property(e, '', prop)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    unreal.log(f'[client materials] {path} saved')



LAMP_HLSL = r"""
int role = (int)(Role + 0.5);
int m = (int)(Mask + 0.5);
float3 tint = role == 4 ? float3(0.9, 0.04, 0.03) : ((role == 2 || role == 3 || role == 5 || role == 6) ? float3(1.0, 0.45, 0.03)
    : (role == 8 ? float3(1.0, 0.05, 0.03) : (role == 9 ? float3(0.08, 0.2, 1.0) : float3(1.0, 0.96, 0.88))));
float blink = step(0.5, frac(T * 1.5));
float e = 0.0;
if (role == 1) e = (m & 1) != 0 ? 7.0 : 0.0;
else if (role == 4) e = (m & 4) != 0 ? 6.0 : ((m & 2) != 0 ? 1.6 : 0.0);
else if (role == 2 || role == 5) e = (m & 8) != 0 ? 6.0 * blink : 0.0;
else if (role == 3 || role == 6) e = (m & 16) != 0 ? 6.0 * blink : 0.0;
else if (role == 8) e = (m & 32) != 0 ? 9.0 * step(0.5, frac(T * 2.3)) : 0.0;
else if (role == 9) e = (m & 32) != 0 ? 9.0 * (1.0 - step(0.5, frac(T * 2.3))) : 0.0;
return float4(tint, e);
"""


def lamp():
    """M_client_lamp: the fleet's lamps and sirens (fleet24.js patch, lamp: a tinted lens over a bright reflector, the lit
    roles emissive). The role is each vertex's (the models' _LAMP, Tools/fleet_glb.mjs packs it in UV 1), the lamp mask the
    instance's (its first per-instance float, the record's lamps: bit 0 head, 1 tail, 2 brake, 3 and 4 the blinkers, 5 the
    siren); the blinkers and sirens flash on the material's own time. Emission in the city materials' units (the browser's)."""
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    path = f'{DEST}/M_client_lamp'
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset('M_client_lamp', DEST, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('used_with_instanced_static_meshes', True)
    uv = mel.create_material_expression(m, unreal.MaterialExpressionTextureCoordinate, -1000, -200)
    uv.set_editor_property('coordinate_index', 1)
    role = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -850, -200)
    role.set_editor_property('r', True)
    mel.connect_material_expressions(uv, '', role, '')
    mask = mel.create_material_expression(m, unreal.MaterialExpressionPerInstanceCustomData, -850, -60)
    mask.set_editor_property('data_index', 0)
    mask.set_editor_property('const_default_value', 0.0)
    t = mel.create_material_expression(m, unreal.MaterialExpressionTime, -850, 60)
    c = mel.create_material_expression(m, unreal.MaterialExpressionCustom, -600, -100)
    c.set_editor_property('code', LAMP_HLSL)
    c.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT4)
    c.set_editor_property('description', 'lamp terms')
    ins = []
    for n in ('Role', 'Mask', 'T'):
        ci = unreal.CustomInput()
        ci.set_editor_property('input_name', n)
        ins.append(ci)
    c.set_editor_property('inputs', ins)
    mel.connect_material_expressions(role, '', c, 'Role')
    mel.connect_material_expressions(mask, '', c, 'Mask')
    mel.connect_material_expressions(t, '', c, 'T')
    tint = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -400, -200)
    for ch in ('r', 'g', 'b'):
        tint.set_editor_property(ch, True)
    mel.connect_material_expressions(c, '', tint, '')
    e = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -400, 0)
    e.set_editor_property('a', True)
    mel.connect_material_expressions(c, '', e, '')
    # base colour: the reflector's grey through the lens's tint at 85 %
    grey = mel.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -400, -320)
    grey.set_editor_property('constant', unreal.LinearColor(0.847, 0.855, 0.871, 1))
    lens = mel.create_material_expression(m, unreal.MaterialExpressionLinearInterpolate, -250, -260)
    lens.set_editor_property('const_a', 1.0)
    lens.set_editor_property('const_alpha', 0.85)
    mel.connect_material_expressions(tint, '', lens, 'B')
    base = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -100, -300)
    mel.connect_material_expressions(grey, '', base, 'A')
    mel.connect_material_expressions(lens, '', base, 'B')
    mel.connect_material_property(base, '', unreal.MaterialProperty.MP_BASE_COLOR)
    k = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -400, 120)
    k.set_editor_property('parameter_name', 'LampK')
    k.set_editor_property('default_value', 1.0)
    ek = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -250, 40)
    mel.connect_material_expressions(e, '', ek, 'A')
    mel.connect_material_expressions(k, '', ek, 'B')
    em = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -100, -40)
    mel.connect_material_expressions(tint, '', em, 'A')
    mel.connect_material_expressions(ek, '', em, 'B')
    mel.connect_material_property(em, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    for prop, val, y in ((unreal.MaterialProperty.MP_ROUGHNESS, 0.18, 200), (unreal.MaterialProperty.MP_METALLIC, 0.55, 300)):
        x = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -250, y)
        x.set_editor_property('r', val)
        mel.connect_material_property(x, '', prop)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    unreal.log(f'[client materials] {path} saved')

import os
if os.environ.get('CLIENT_MATERIALS', 'semantic,id,glass').find('glass') >= 0:
    glass()
if os.environ.get('CLIENT_MATERIALS', 'semantic,id') .find('semantic') >= 0:
    semantic()
if os.environ.get('CLIENT_MATERIALS', 'semantic,id').find('id') >= 0:
    instance_id()
if os.environ.get('CLIENT_MATERIALS', 'semantic,id,glass,lamp').find('lamp') >= 0:
    lamp()
