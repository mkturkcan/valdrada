# The persistent city level's editor side (tools/ue/persist_build.py writes the job, PERSIST_JOB): create the World
# Partition map and its grids if asked, then add, update or remove the job's actors (level instances streamed as
# levels, ValdradaWorld stream cells) and save; the result json lists the labels done.
import json, os, time, traceback
import unreal

J = json.load(open(os.environ['PERSIST_JOB']))
R = {'done': [], 'errors': [], 'map_ok': False}
t0 = time.time()
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
CELL_CLS = unreal.load_class(None, '/Script/ValdradaWorld.ValdradaStreamCell')
LI_CLS = unreal.load_class(None, '/Script/ValdradaWorld.ValdradaLevelStreamer')


def save_result():
    R['secs'] = round(time.time() - t0, 1)
    json.dump(R, open(J['result'], 'w'), indent=1)


def apply(a, e):
    a.set_actor_label(e['label'])
    a.set_editor_property('tags', [unreal.Name(t) for t in e['tags']])
    try: a.set_editor_property('runtime_grid', unreal.Name(e['grid']))
    except Exception as x: R['errors'].append(f"{e['label']}: runtime_grid {x}")
    b = e['bounds']
    bx = unreal.Box(); bx.min = unreal.Vector(b[0], b[1], b[2]); bx.max = unreal.Vector(b[3], b[4], b[5]); bx.is_valid = True
    a.set_editor_property('stream_bounds', bx)
    a.set_actor_location(unreal.Vector((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, 0.0), False, False)   # (small actors stream by their location)
    if e['kind'] == 'li':
        lv = e['level'] + '.' + e['level'].split('/')[-1]
        try: ref = unreal.SystemLibrary.conv_soft_obj_path_to_soft_obj_ref(unreal.SoftObjectPath(lv))   # (by path: the level is not loaded here)
        except Exception: ref = unreal.load_asset(e['level'])
        a.set_editor_property('level', ref)
    else:
        a.set_editor_property('table_paths', e['tables'])
        a.set_editor_property('ray_tracing', bool(e.get('rt', True)))


try:
    if J['create']:
        ok = les.new_level(J['map'], True)
        world = unreal.EditorLevelLibrary.get_editor_world()
        g = J['grids']
        R['grids'] = unreal.ValdradaWorldLib.set_spatial_hash_grids(world, [x[0] for x in g], [int(x[1]) for x in g], [float(x[2]) for x in g], True)
        unreal.log('[persist] new level ' + str(ok) + ' ' + R['grids'])
    else:
        les.load_level(J['map'])
        world = unreal.EditorLevelLibrary.get_editor_world()
        if J.get('set_grids'):
            g = J['grids']
            unreal.ValdradaWorldLib.set_spatial_hash_grids(world, [x[0] for x in g], [int(x[1]) for x in g], [float(x[2]) for x in g], True)
            world.get_outer().mark_package_dirty() if hasattr(world.get_outer(), 'mark_package_dirty') else None
        R['grids'] = unreal.ValdradaWorldLib.describe_runtime_hash(world)
    wp_ = world.get_world_partition() if hasattr(world, 'get_world_partition') else None
    ops = J['ops']
    # the actors to change or remove: loaded by their guids (World Partition keeps them unloaded in the editor)
    need = {o['label'] for o in ops if o['op'] in ('upd', 'rem')}
    found = {}
    if need:
        descs = unreal.WorldPartitionBlueprintLibrary.get_actor_descs()
        guids = [d.guid for d in descs if str(d.label) in need]
        if guids: unreal.WorldPartitionBlueprintLibrary.load_actors(guids)
        for a in eas.get_all_level_actors():
            if a.get_actor_label() in need: found[a.get_actor_label()] = a
    n = 0
    for o in ops:
        try:
            if o['op'] == 'rem':
                if o['label'] in found and not eas.destroy_actor(found[o['label']]): raise RuntimeError('could not remove')
            elif o['op'] == 'upd':
                a = found.get(o['label'])
                want = 'ValdradaLevelStreamer' if o['kind'] == 'li' else 'ValdradaStreamCell'
                if a is None: raise RuntimeError('not found for update')   # (never spawn beside it: a second actor under one label)
                if str(a.get_class().get_name()) == want: apply(a, o)
                else:
                    if not eas.destroy_actor(a): raise RuntimeError('could not replace')
                    apply(eas.spawn_actor_from_class(LI_CLS if o['kind'] == 'li' else CELL_CLS, unreal.Vector(0, 0, 0)), o)
            else:
                apply(eas.spawn_actor_from_class(LI_CLS if o['kind'] == 'li' else CELL_CLS, unreal.Vector(0, 0, 0)), o)
            R['done'].append(o['label']); n += 1
        except Exception as x:
            R['errors'].append(f"{o['label']}: {type(x).__name__}: {x}"[:300])
        if n and n % 2000 == 0: unreal.log(f'[persist] {n} of {len(ops)}')
    ts = time.time()
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    R['save_s'] = round(time.time() - ts, 1)
    R['map_ok'] = unreal.EditorAssetLibrary.does_asset_exist(J['map'])
except Exception:
    R['errors'].append(traceback.format_exc()[-1500:])
save_result()
unreal.log('[persist] DONE ' + json.dumps({k: (v if k != 'done' else len(v)) for k, v in R.items()})[:1500])
