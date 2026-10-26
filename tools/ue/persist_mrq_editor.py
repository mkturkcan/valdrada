# The shots' Movie Render Queue settings as assets (tools/ue/persist_render.py --save-config writes the job,
# PERSIST_MRQ): each shot's patched manifest (the take's job settings on L_City and LS_<shot>) saved as the primary config
# /Game/City/MRQ/PC_<shot>, so a cooked build renders it by name (-LevelSequence and -MoviePipelineConfig, no manifest)
# and the shot server allocates its job from it.
import json, os, traceback
import unreal

J = json.load(open(os.environ['PERSIST_MRQ']))
R = {'saved': [], 'errors': []}
at = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
for e in J['shots']:
    try:
        q = unreal.MoviePipelineLibrary.load_manifest_file_from_string(e['manifest'])
        cfg = q.get_jobs()[0].get_configuration()
        path, name = e['dest'].rsplit('/', 1)
        a = unreal.load_asset(e['dest']) if eal.does_asset_exist(e['dest']) else at.create_asset(name, path, unreal.MoviePipelinePrimaryConfig, None)
        a.copy_from(cfg)
        out = a.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
        d = unreal.DirectoryPath(); d.set_editor_property('path', e['out']); out.set_editor_property('output_directory', d)
        eal.save_loaded_asset(a)
        R['saved'].append(e['dest'])
        # the queue as an asset too (its job names L_City and the sequence): a cooked build opened on the queue's entry
        # map renders it with one load of the city (given the city on the command line, the queue loads it a second time)
        qd = e['dest'].replace('/PC_', '/Q_')
        qa = unreal.load_asset(qd) if eal.does_asset_exist(qd) else at.create_asset(qd.rsplit('/', 1)[1], path, unreal.MoviePipelineQueue, None)
        qa.copy_from(q)
        qa.get_jobs()[0].set_configuration(a)
        eal.save_loaded_asset(qa)
        R['saved'].append(qd)
    except Exception:
        R['errors'].append(traceback.format_exc()[-800:])
json.dump(R, open(J['result'], 'w'), indent=1)
unreal.log('[persist_mrq] DONE ' + json.dumps(R)[:1500])
