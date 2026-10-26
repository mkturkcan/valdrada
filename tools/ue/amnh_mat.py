# RETIRED 2026-10-24: lmAmnh.js draws on its own pbrLib sets (amnh_*), so its library keys are its own and every rebind binds them
# from ue_families.json hq.pbr; the split below is kept for the record (amnh_mat.json is empty).
# AMNH (client/src/city/lmAmnh.js) on the library's sets, on instances of its own (AMNH SPLIT: /Game/MatLib/amnh/MI_amnh_*,
# duplicated from the shared kit keys and set on block 3e6c21d660d832d861cc's meshes g157/g144/g155 only, C['split']; the shared
# kit terracotta, pink granite and ashlar keys keep their own binding; a re-import of that block points them back), parameters only (no master or binding-rule change, so no rebind
# signature and no take key moves): the copper roofs on the Central Park lakeside verdigris set, the kit terracotta (city-wide: its one key) on clay roof tiles and the
# Memorial ashlar world-mapped with coursed normal/ORM, the pink granite's relief up. A matlib rebind of these folders resets
# them; the clay tile set is clay_roof_tiles_02 (assets/hq/hq.json). Run again after one:  UnrealEditor-Cmd <project> -run=pythonscript -script=tools/ue/amnh_mat.py with AMNH_CFG=tools/ue/amnh_mat.json
import unreal, json, os
C = json.load(open(os.environ['AMNH_CFG']))
eal = unreal.EditorAssetLibrary; mel = unreal.MaterialEditingLibrary; at = unreal.AssetToolsHelpers.get_asset_tools()
out = {'before': {}, 'after': {}}
def dump(mi):
    return {'parent': mi.get_editor_property('parent').get_path_name() if mi.get_editor_property('parent') else None,
            's': {str(p.get_editor_property('parameter_info').get_editor_property('name')): p.get_editor_property('parameter_value') for p in mi.get_editor_property('scalar_parameter_values')},
            'v': {str(p.get_editor_property('parameter_info').get_editor_property('name')): str(p.get_editor_property('parameter_value')) for p in mi.get_editor_property('vector_parameter_values')},
            't': {str(p.get_editor_property('parameter_info').get_editor_property('name')): (p.get_editor_property('parameter_value').get_path_name() if p.get_editor_property('parameter_value') else None) for p in mi.get_editor_property('texture_parameter_values')}}
for ap in C['dump']:
    mi = eal.load_asset(ap); out['before'][ap] = dump(mi) if mi else None
# textures
tasks = []
for nm, path, srgb in C['import']:
    if eal.does_asset_exist(f"{C['texlib']}/{nm}"): continue
    t = unreal.AssetImportTask()
    for k, v in (('filename', path), ('destination_path', C['texlib']), ('destination_name', nm), ('automated', True), ('replace_existing', True), ('save', False)): t.set_editor_property(k, v)
    tasks.append(t)
if tasks: at.import_asset_tasks(tasks)
for nm, path, srgb in C['import']:
    t_ = eal.load_asset(f"{C['texlib']}/{nm}")
    if t_ is None: continue
    t_.set_editor_property('srgb', bool(srgb))
    if not srgb: t_.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_MASKS)
    eal.save_loaded_asset(t_)
for src, (dst, meshes) in (C.get('split') or {}).items():
    if not eal.does_asset_exist(dst): eal.duplicate_asset(src, dst)
    # an entry ending in '/' is a block's folder: every static mesh in it (a rebuilt block's groups get new names)
    mlist = []
    for mp in meshes:
        if mp.endswith('/'): mlist += [x.split('.')[0] for x in eal.list_assets(mp, recursive=True, include_folder=False)]
        else: mlist.append(mp)
    for mp in mlist:
        sm = eal.load_asset(mp)
        if not isinstance(sm, unreal.StaticMesh): continue
        for i, s_ in enumerate(sm.get_editor_property('static_materials')):
            m_ = s_.get_editor_property('material_interface')
            if m_ and (m_.get_path_name().split('.')[0] == src or m_.get_name() == src.split('/')[-1]): sm.set_material(i, eal.load_asset(dst))
        eal.save_loaded_asset(sm)
if C.get('apply'):
    for ap, P in C['set'].items():
        mi = eal.load_asset(ap)
        if mi is None: out.setdefault('missing', []).append(ap); continue
        for n, v in P.get('s', {}).items(): mel.set_material_instance_scalar_parameter_value(mi, n, float(v))
        for n, v in P.get('v', {}).items(): mel.set_material_instance_vector_parameter_value(mi, n, unreal.LinearColor(*[float(x) for x in v]))
        for n, v in P.get('t', {}).items(): mel.set_material_instance_texture_parameter_value(mi, n, eal.load_asset(v))
        mel.update_material_instance(mi); eal.save_loaded_asset(mi)
        out['after'][ap] = dump(mi)
open(C['out'], 'w').write(json.dumps(out, indent=1, default=str))
