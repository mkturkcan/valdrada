# A shot of the persistent city (tools/ue/persist_render.py writes the job, PERSIST_SHOT): the take's sequence copied to
# /Game/City/Shots/LS_<shot> and made self-contained, so it plays in /Game/City/L_City: its lens and its light rig (sun,
# sky light, atmosphere, clouds, fog, post process, lamps, every BX_ actor of the take's actor level) become spawnables
# copied from the take's actors with their tracks moved over; the MPC keys (time of day) stay as they are; the movers'
# importer subsequences are left out (phase 1).
import json, os, time, traceback
import unreal

J = json.load(open(os.environ['PERSIST_SHOT']))
R = {'errors': [], 'spawnables': [], 'ok': False}
t0 = time.time()
eal = unreal.EditorAssetLibrary
MSE, MBE = unreal.MovieSceneSequenceExtensions, unreal.MovieSceneBindingExtensions
RIG = tuple(getattr(unreal, n) for n in ('Light', 'SkyLight', 'SkyAtmosphere', 'VolumetricCloud', 'ExponentialHeightFog', 'PostProcessVolume', 'CameraActor')
            if hasattr(unreal, n))


def spawn_all(ls, b):
    """the spawnable present over the whole playback range (and the pre-roll before it)"""
    try:
        tr = b.add_track(unreal.MovieSceneSpawnTrack)
        sec = tr.add_section(); sec.set_range(-100000, 1000000)
        for ch in sec.get_all_channels():
            try: ch.set_default(True)
            except Exception: pass
    except Exception as x:
        R['errors'].append(f'spawn track: {x}'[:200])


try:
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).load_level(J['act_level'])
    world = unreal.EditorLevelLibrary.get_editor_world()
    dst = J['dest']
    if eal.does_asset_exist(dst): eal.delete_asset(dst)
    eal.duplicate_asset(J['sequence'], dst)
    ls = unreal.load_asset(dst)
    # the movers' importer subsequences (traffic, walkers: their bindings are the take level's actors): each copied
    # beside the shot with its actors made spawnables, as the lens and the rig below (2026-10-25); a subsequence that
    # fails is left out
    cnt = [0]
    def movers(sub, depth=0):
        cnt[0] += 1
        dsub = f'{dst}_mv{cnt[0]}'
        if eal.does_asset_exist(dsub): eal.delete_asset(dsub)
        eal.duplicate_asset(sub.get_path_name().split('.')[0], dsub)
        sq = unreal.load_asset(dsub); n = 0; cls = {}
        for b in list(MSE.get_possessables(sq)):
            objs = MSE.locate_bound_objects(sq, b, world)
            a = objs[0] if objs else None
            if not isinstance(a, unreal.Actor): continue
            cls[type(a).__name__] = cls.get(type(a).__name__, 0) + 1
            if len(R.setdefault('mover_eg', [])) < 3:
                R['mover_eg'].append({'label': a.get_actor_label(), 'comps': [type(c).__name__ for c in a.get_components_by_class(unreal.ActorComponent)][:8],
                                      'attached': [x.get_actor_label() + ':' + type(x).__name__ for x in a.get_attached_actors()][:6]})
            sp = MSE.add_spawnable_from_instance(sq, a); MBE.move_binding_contents(b, sp)
            for ch in MBE.get_child_possessables(b):
                try: MBE.set_parent(ch, sp)
                except Exception as x: R['errors'].append(f'mover reparent: {x}'[:200])
            try: MBE.set_display_name(sp, a.get_actor_label())
            except Exception: pass
            spawn_all(sq, sp); MBE.remove(b); n += 1
        if depth < 4:
            for tr_ in sq.get_tracks():
                if isinstance(tr_, unreal.MovieSceneSubTrack):
                    for sec_ in tr_.get_sections():
                        ch_ = sec_.get_sequence()
                        if ch_ is not None: c2, n2 = movers(ch_, depth + 1); sec_.set_sequence(c2); n += n2
        R.setdefault('mover_subs', []).append({'sub': sub.get_path_name(), 'depth': depth, 'made': n, 'classes': cls})
        eal.save_loaded_asset(sq)
        return sq, n
    k = 0
    for tr in list(ls.get_tracks()):
        if not isinstance(tr, unreal.MovieSceneSubTrack): continue
        ok_ = os.environ.get('PERSIST_MOVERS', '1') == '1'
        for sec in (tr.get_sections() if ok_ else []):
            try:
                sub = sec.get_sequence()
                if sub is None: continue
                sq, n = movers(sub)
                sec.set_sequence(sq); R['movers'] = R.get('movers', 0) + n
            except Exception as x:
                R['errors'].append(f'movers: {x}'[:300]); ok_ = False
        if not ok_: ls.remove_track(tr); R['removed_subtracks'] = R.get('removed_subtracks', 0) + 1
    # (a shot with more movers than the sequencer's entity ids hold is left without them: lfAerial125's 21,367
    # spawnables failed 'Index & 0xFFFF0000' in MovieSceneEntityIDs at the first frame; those shots keep the take path's
    # movers only through the take path)
    if R.get('movers', 0) > int(os.environ.get('PERSIST_MOVERS_MAX', '12000')):
        for tr in list(ls.get_tracks()):
            if isinstance(tr, unreal.MovieSceneSubTrack): ls.remove_track(tr)
        R['movers_dropped'] = R.pop('movers')
    done_actors = set(); new_of = {}
    for b in list(MSE.get_possessables(ls)):
        objs = MSE.locate_bound_objects(ls, b, world)
        a = objs[0] if objs else None
        if not isinstance(a, unreal.Actor): continue
        sp = MSE.add_spawnable_from_instance(ls, a)
        MBE.move_binding_contents(b, sp)
        for ch in MBE.get_child_possessables(b):
            try: MBE.set_parent(ch, sp)
            except Exception as x: R['errors'].append(f'reparent: {x}'[:200])
        name = a.get_actor_label()
        try: MBE.set_display_name(sp, name)
        except Exception: pass
        spawn_all(ls, sp)
        new_of[str(MBE.get_id(b))] = sp; done_actors.add(name)
        MBE.remove(b)
        R['spawnables'].append(name)
    # the camera cut to the new lens
    for tr in ls.get_tracks():
        if isinstance(tr, unreal.MovieSceneCameraCutTrack):
            for sec in tr.get_sections():
                cam = next((sp for sp in new_of.values() if str(MBE.get_display_name(sp)) in ('BX_Camera',) or 'Camera' in str(MBE.get_display_name(sp))), None)
                if cam is not None: sec.set_camera_binding_id(MSE.get_portable_binding_id(ls, ls, cam)); R['camera_cut'] = str(MBE.get_display_name(cam))
    # the rest of the light rig: every light, sky, fog and post-process actor of the take's level
    for a in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors():
        lab = a.get_actor_label()
        if lab in done_actors or not isinstance(a, RIG) or isinstance(a, unreal.CameraActor): continue
        sp = MSE.add_spawnable_from_instance(ls, a)
        try: MBE.set_display_name(sp, lab)
        except Exception: pass
        spawn_all(ls, sp); R['spawnables'].append(lab)
    eal.save_loaded_asset(ls)
    R['ok'] = True
except Exception:
    R['errors'].append(traceback.format_exc()[-2000:])
R['secs'] = round(time.time() - t0, 1)
json.dump(R, open(J['result'], 'w'), indent=1)
unreal.log('[persist_shot] DONE ' + json.dumps(R)[:2000])
