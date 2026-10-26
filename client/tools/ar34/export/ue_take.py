# UE (AR34, 2026-10-06): an Unreal Engine 5 take of a shot from the take's USD, the counterpart of blender_take.py.
#
#   python3 ue_take.py --usd <usd dir>/<shot>.usda [--frames 0-107 | 0,54,107] [--outdir client/shots/ad/clips_ue/<shot>]
#       [--res 2560x1440] [--work /data0/projectnyc_aux/tmp/ue/<shot>] [--gpu 0] [--overwrite] [--noimport] [--norender]
#       [--warmup 48] [--spatial 1] [--temporal 1] [--mblur 0.5] [--ev <exposure bias>] [--nort] [--nomegalights]
#       [--peds] [--quality 95]
#
# Three stages, one per process:
#   1. prep    ue_prep.py with the exporter's Python: <work>/prep/<shot>_ue.usda (the per-vertex data as UV sets, the moving
#              sets as animated Xforms) and ue_<shot>.json (the take's data, the materials' `bx` tags, the moving instances);
#   2. import  UnrealEditor-Cmd -run=pythonscript with this file (BXUE_CFG names the run's JSON): the master materials when
#              missing (ue_project/Python/ue_masters.py), the USD Stage importer into /Game/Takes/<shot>/ (Nanite meshes,
#              actors, the importer's Level Sequence with the camera's and the moving sets' tracks), ue_mat.py (each `bx`
#              material as an instance of its family's master), ue_light.py (sun, sky, street and vehicle lamps, exposure,
#              the film look), the take's Level Sequence LS_<shot> (the importer's as a subsequence, a camera cut on the
#              USD camera) and a Movie Render Queue manifest (Saved/MovieRenderPipeline/<shot>.utxt);
#   3. render  UnrealEditor -game -MoviePipelineConfig=<manifest> -RenderOffscreen: Lumen, the frames as JPEG into the
#              take folder, renamed like the web and Cycles takes (frame_%05d.jpg).
# Prints TAKE_FRAME lines (per frame: seconds from the previous frame's file) and TAKE_STATS; take.json in the frames' folder
# holds the same (prep_s, import_s, render_s, first_frame_s, mean_frame_s). Existing frames are kept unless --overwrite.
# The engine: /data0/projectnyc_aux/ue/UE_5.8 (UE_ROOT), the project: ue_project/BoundlessUE.uproject next to this file.
import json, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')
PROJECT = os.path.join(HERE, 'ue_project', 'BoundlessUE.uproject')
DDC = os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc')


# the import and render options the take cannot do without: a missing one (an engine version that renamed it) fails the import
CORE = {'import_actors', 'import_geometry', 'import_materials', 'import_level_sequences', 'purposes_to_import',
        'nanite_triangle_threshold', 'share_assets_for_identical_prims', 'existing_actor_policy', 'existing_asset_policy',
        'filename', 'destination_path', 'automated', 'replace_existing', 'options', 'job_name', 'sequence', 'map',
        'output_directory', 'file_name_format', 'zero_pad_frame_numbers', 'output_resolution', 'use_custom_playback_range',
        'custom_start_frame', 'custom_end_frame', 'spatial_sample_count', 'temporal_sample_count', 'override_anti_aliasing',
        'anti_aliasing_method', 'engine_warm_up_count', 'render_warm_up_count', 'render_warm_up_frames', 'additional_post_process_materials'}
MISS = []


def sp(obj, k, v):
    """obj.k = v through the reflection system; a property this engine version lacks is recorded (import.json
    option_misses), and fails the import when it is one of CORE."""
    try:
        obj.set_editor_property(k, v); return True
    except Exception as e:
        MISS.append(f'{type(obj).__name__}.{k}: {e}')
        if k in CORE: raise RuntimeError(f'core option {type(obj).__name__}.{k} missing in this engine: {e}')
        return False


def ue_env(extra=None):
    """the environment of every engine process: the derived data cache on /data0 (the home drive is nearly full)."""
    e = dict(os.environ)
    e['UE-LocalDataCachePath'] = DDC
    e['UE-SharedDataCachePath'] = 'None'
    e['UE_PYTHONPATH'] = os.pathsep.join([HERE, os.path.join(HERE, 'ue_project', 'Python')])
    # Vulkan: the NVIDIA driver only (the machine also lists Mesa's CPU and Intel drivers); -graphicsadapter picks the GPU
    if os.path.exists('/usr/share/vulkan/icd.d/nvidia_icd.json'): e.setdefault('VK_ICD_FILENAMES', '/usr/share/vulkan/icd.d/nvidia_icd.json')
    if extra: e.update(extra)
    return e


# ======================================================================================================================
# inside the engine (UnrealEditor-Cmd -run=pythonscript -script=ue_take.py, BXUE_CFG=<run json>)
# ======================================================================================================================
def in_engine():
    import unreal
    for p in (HERE, os.path.join(HERE, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    import importlib, ue_masters, ue_mat, ue_light
    for m in (ue_masters, ue_mat, ue_light): importlib.reload(m)
    cfg = json.load(open(os.environ['BXUE_CFG']))
    side = json.load(open(cfg['side']))
    shot = cfg['shot']
    T = {}
    log = lambda *a: unreal.log('[bxue] ' + ' '.join(str(x) for x in a))
    t0 = time.time()
    dest = f'/Game/Takes/{shot}'
    eal = unreal.EditorAssetLibrary
    atools = unreal.AssetToolsHelpers.get_asset_tools()

    # ---- master materials (once per project)
    if not cfg.get('nomat'):
        try: T['board_master'] = ue_masters.board_refresh()   # TSQADS: M_bx_board and MPC_bx when missing or stale (own marker)
        except Exception as e: T['board_master'] = {'error': f'{type(e).__name__}: {e}'}
        t = time.time(); T['masters'] = ue_masters.ensure(); T['masters_s'] = round(time.time() - t, 1)

    # ---- a fresh level and import (the level is built from the USD every time; nothing is edited in a saved level).
    # R4-CACHE: when the driver finds this shot's previous import made from the very same USD layers and prep (a fingerprint
    # beside the imported assets), the stage's meshes, textures, actors and the importer's sequence are kept and only the
    # level is loaded; materials, lights, the trees, the sequence and the manifests are made again below as on a fresh import
    level = f'{dest}/L_{shot}'
    if cfg.get('reuse_stage') and eal.does_asset_exist(level):
        t = time.time()
        unreal.EditorLoadingAndSavingUtils.load_map(level)
        T['stage_reused'] = True; T['delete_s'] = 0.0; T['import_s'] = 0.0; T['load_map_s'] = round(time.time() - t, 1)
        log('stage reused', T['load_map_s'], 's')
    else:
        t = time.time()
        if eal.does_directory_exist(dest):   # the previous import of this shot (thousands of packages: slow)
            eal.delete_directory(dest)
        T['delete_s'] = round(time.time() - t, 1)
        t = time.time()
        level = f'{dest}/L_{shot}'
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
        world = unreal.EditorLevelLibrary.get_editor_world()
        opts = unreal.UsdStageImportOptions()
        sp(opts, 'import_actors', True)
        sp(opts, 'import_geometry', True)
        sp(opts, 'import_skeletal_animations', bool(cfg.get('peds')))
        sp(opts, 'import_level_sequences', True)
        sp(opts, 'import_materials', True)
        sp(opts, 'import_only_used_materials', True)
        sp(opts, 'purposes_to_import', 2)              # render (EUsdPurpose: proxy 1, render 2, guide 4; default always)
        sp(opts, 'nanite_triangle_threshold', int(cfg.get('nanite_tris', 1)))
        sp(opts, 'share_assets_for_identical_prims', True)
        sp(opts, 'merge_identical_material_slots', False)
        sp(opts, 'prim_path_folder_structure', False)
        sp(opts, 'existing_actor_policy', unreal.ReplaceActorPolicy.REPLACE)
        sp(opts, 'existing_asset_policy', unreal.ReplaceAssetPolicy.REPLACE)
        sp(opts, 'use_prim_kinds_for_collapsing', False)
        task = unreal.AssetImportTask()
        sp(task, 'filename', side['ue_root'])
        sp(task, 'destination_path', dest)
        sp(task, 'automated', True)
        sp(task, 'replace_existing', True)
        sp(task, 'save', False)
        sp(task, 'options', opts)
        atools.import_asset_tasks([task])
        T['import_s'] = round(time.time() - t, 1)
        T['imported_objects'] = len(task.get_editor_property('imported_object_paths') or [])
        log('import', T['import_s'], 's', T['imported_objects'], 'objects')
        t = time.time()
        unreal.EditorLoadingAndSavingUtils.save_map(world, level)
        T['save_map_s'] = round(time.time() - t, 1)
    world = unreal.EditorLevelLibrary.get_editor_world()
    actors = unreal.EditorLevelLibrary.get_all_level_actors()
    T['actors'] = len(actors)

    # ---- materials and lights (the hooks)
    import traceback
    for key, fn in (('mat', lambda: ue_mat.apply(side, dest, cfg)), ('light', lambda: ue_light.apply(side, dest, cfg, world))):
        t = time.time()
        try: T[key] = fn()
        except Exception as e:   # a hook's failure fails the take (import.json keeps the error for the driver)
            T[key] = {'error': f'{type(e).__name__}: {e}'}; T['error'] = f'{key} hook: {type(e).__name__}: {e}'
            T['option_misses'] = MISS
            unreal.log_error('[bxue] ' + key + ' failed: ' + traceback.format_exc())
            json.dump(T, open(cfg['import_json'], 'w'), indent=1)
            raise
        T[key + '_s'] = round(time.time() - t, 1)
    # ---- TREEUE (2026-10-07): the tree set's foliage and bark masters, wind, Nanite foliage (ue_trees.py; a first-set take
    # is left as ue_mat made it; a failure is recorded in import.json 'trees' and the take goes on with ue_mat's look)
    try:
        import ue_trees; importlib.reload(ue_trees); t = time.time(); T['trees'] = ue_trees.apply(side, dest, cfg); T['trees_s'] = round(time.time() - t, 1)
    except Exception as e:
        T['trees'] = {'error': f'{type(e).__name__}: {e}'}; unreal.log_error('[bxue] trees failed: ' + traceback.format_exc())
    # ---- /TREEUE

    # ---- the take's sequence: the importer's as a subsequence, a camera cut on the USD camera
    t_seq = time.time()
    nF = side['frames'][1] - side['frames'][0] + 1
    seqs = [a for a in eal.list_assets(dest, recursive=True, include_folder=False) if eal.find_asset_data(a).asset_class_path.asset_name == 'LevelSequence']
    # the importer's sequence of the root layer (LS_<shot>_ue; one per layer with time samples, the sublayers' as its
    # subsequences), never this tool's own LS_<shot>
    stem = os.path.splitext(os.path.basename(side['ue_root']))[0]
    seqs = [a for a in seqs if '/LevelSequences/' in a]
    pick = next((a for a in seqs if a.split('/')[-1].split('.')[0] in ('LS_' + stem, stem)), seqs[0] if seqs else None)
    root_seq = eal.load_asset(pick) if pick else None
    T['importer_sequences'] = len(seqs)
    # the lens: a camera of this tool's, keyed in world space every frame from the USD (ue_prep's camera.ue); the importer's
    # camera (keyed relative to its parent) is the fallback
    cam = ue_light.take_camera(side, cfg) if (side.get('camera') or {}).get('ue') else None
    if cam is None:
        cam_path = side['data'].get('camera') or ''
        for a in actors:
            if isinstance(a, unreal.CameraActor) and (a.get_actor_label() == cam_path.split('/')[-1] or cam is None): cam = a
    T['camera'] = cam.get_actor_label() if cam else None
    ls_path = f'{dest}/LS_{shot}'
    if eal.does_asset_exist(ls_path): eal.delete_asset(ls_path)
    ls = atools.create_asset(f'LS_{shot}', dest, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    fps = int(round(side.get('fps') or 30))
    ls.set_display_rate(unreal.FrameRate(fps, 1))
    ls.set_playback_start(0); ls.set_playback_end(nF)
    if root_seq is not None:
        sub = ls.add_track(unreal.MovieSceneSubTrack)
        sec = sub.add_section(); sec.set_sequence(root_seq); sec.set_range(0, nF)
    if cam is not None:
        cam_b = ls.add_possessable(cam)
        cut = ls.add_track(unreal.MovieSceneCameraCutTrack)
        cs = cut.add_section(); cs.set_range(0, nF)
        try: bid = unreal.MovieSceneSequenceExtensions.get_portable_binding_id(ls, ls, cam_b)
        except Exception: bid = ls.get_binding_id(cam_b)
        cs.set_camera_binding_id(bid)
        T['camera_tracks'] = ue_light.camera_settings(cam, side, cfg, sub_sequences(unreal, root_seq))
        if cam.get_actor_label() == 'BX_Camera': T['camera_keys'] = ue_light.key_camera(ls, cam_b, side)
        if cfg.get('cine'): T['cine_focus'] = ue_light.key_focus(ls, cam, side, cfg)   # R4-CINE
    T['moving_tracks'] = ue_light.check_moving_tracks(root_seq, side) if root_seq is not None else None
    # TSQADS: the Times Square boards' cell tables and the web's sim time on MPC_bx.SimT (ue_mat.board_take)
    try: T['boards'] = ue_mat.board_take(side, dest, cfg, ls)
    except Exception as e: T['boards'] = {'error': f'{type(e).__name__}: {e}'}; unreal.log_error('[bxue] boards failed: ' + traceback.format_exc())
    # R9-PREROLL (UE track, 2026-10-08): the take's traffic, trains and lens already moving through the warm-up
    try: T['preroll'] = preroll(unreal, ls, root_seq, cfg)
    except Exception as e: T['preroll'] = {'error': f'{type(e).__name__}: {e}'}; unreal.log_error('[bxue] preroll failed: ' + traceback.format_exc())
    eal.save_loaded_asset(ls)
    T['seq_s'] = round(time.time() - t_seq, 1)
    # (saving waits for the meshes' Nanite and distance-field builds the import started)
    t = time.time()
    eal.save_directory(dest, only_if_is_dirty=True, recursive=True)
    unreal.EditorLoadingAndSavingUtils.save_map(world, level)
    T['save_s'] = round(time.time() - t, 1)

    # ---- the Movie Render Queue manifests: this run's frames ('run') and the whole take ('all', for a later --noimport run)
    lo, hi = side['frames']
    t = time.time()
    T['mrq'] = {k: mrq_manifest(unreal, cfg, side, level, ls.get_path_name(), k, rs) for k, rs in (('run', cfg['ranges']), ('all', [[lo, hi]]))}
    T['mrq_s'] = round(time.time() - t, 1)
    T['secs'] = round(time.time() - t0, 1)
    T['option_misses'] = MISS
    json.dump(T, open(cfg['import_json'], 'w'), indent=1)
    log('IMPORT_DONE', json.dumps(T)[:2000])


def sub_sequences(unreal, seq):
    """a sequence and every sequence under it through subsequence tracks."""
    out, todo = [], [seq]
    while todo:
        s = todo.pop()
        if s is None or s in out: continue
        out.append(s)
        for tr in s.get_tracks():
            if isinstance(tr, unreal.MovieSceneSubTrack):
                todo += [sec.get_sequence() for sec in tr.get_sections()]
    return out


# R9-PREROLL (UE track, 2026-10-08): Movie Render Queue warms up with real frames only from camera-cut data left of the
# rendered range; a take rendered from frame 0 had none, so MRQ fell back to holding the sequence through the warm-up and
# jumping it at the capture (the lost-GPU frame, docs/notes/ar34-ue.md, Crash hunt). Here the camera cut starts PREROLL
# frames (the take's warm-up count) before the first rendered frame, the importer's sequences and their sections reach back
# as far (each sequence's playback start with its section's, so inner time stays outer time), and every transform channel
# (the vehicles, the trains, the walkers' roots, the lens) extrapolates linearly before its first key, so the warm-up
# frames drive the traffic and the camera into the shot; visibility and the other channels hold their first value. The
# walkers' skeletal animation sections stay where they are (their clips are timed from the section's start).
def preroll(unreal, ls, root_seq, cfg):
    P = int(os.environ.get('BXUE_PREROLL') or cfg.get('warmup', 48))
    if P <= 0: return {'preroll': 0}
    f0 = min([int(r[0]) for r in cfg.get('ranges') or [[0, 0]]] or [0])
    start = f0 - P
    E = min(start, 0)
    lin = unreal.RichCurveExtrapolation.RCCE_LINEAR
    out = {'preroll': P, 'cut_start': start, 'sequences': 0, 'sections': 0, 'linear_channels': 0, 'skipped': 0}
    seqs = sub_sequences(unreal, root_seq) if root_seq is not None else []
    for s in seqs:
        try:
            if s.get_playback_start() > E: s.set_playback_start(E)
            out['sequences'] += 1
        except Exception: pass
    def extend(sec, to):
        try:
            if sec.has_start_frame() and sec.get_start_frame() > to: sec.set_start_frame(to)
            out['sections'] += 1
        except Exception: out['skipped'] += 1
    def tracks_of(s):
        for t in s.get_tracks(): yield t
        for b in s.get_bindings():
            for t in b.get_tracks(): yield t
    for s in [ls] + seqs:
        for t in tracks_of(s):
            if isinstance(t, unreal.MovieSceneCameraCutTrack):
                for sec in t.get_sections(): extend(sec, start)
            elif isinstance(t, unreal.MovieSceneSubTrack):
                for sec in t.get_sections(): extend(sec, E)
            elif isinstance(t, unreal.MovieSceneSkeletalAnimationTrack):
                out['skipped'] += 1
                # (R9-WALKPRE: the walkers' clips carry ue_prep's frames before 0; where the section clips them (a start
                # offset into the clip), its start moves back over them and the offset shrinks, the clip's timing kept)
                for sec in t.get_sections():
                    try:
                        st_ = sec.get_start_frame() if sec.has_start_frame() else None
                        out['skel_start_min'] = min(out.get('skel_start_min', 10 ** 9), st_) if st_ is not None else out.get('skel_start_min')
                        prm = sec.get_editor_property('params')
                        off = prm.get_editor_property('start_frame_offset').value
                        if st_ is None or off <= 0 or st_ <= E: continue
                        tr = s.get_tick_resolution(); dr = s.get_display_rate()
                        tpf = (tr.numerator / tr.denominator) / (dr.numerator / dr.denominator)
                        mv = int(min(st_ - E, off // tpf))
                        if mv <= 0: continue
                        prm.set_editor_property('start_frame_offset', unreal.FrameNumber(int(off - mv * tpf)))
                        sec.set_editor_property('params', prm); sec.set_start_frame(st_ - mv)
                        out['skel_extended'] = out.get('skel_extended', 0) + 1
                    except Exception as e_:
                        out['skel_err'] = f'{type(e_).__name__}: {e_}'[:160]
            else:
                for sec in t.get_sections():
                    extend(sec, E)
                    if isinstance(t, unreal.MovieScene3DTransformTrack):
                        for ch in sec.get_all_channels():
                            try: ch.set_pre_infinity_extrapolation(lin); out['linear_channels'] += 1
                            except Exception: pass
    return out
# R9-PREROLL end


def mrq_manifest(unreal, cfg, side, level, seq_path, name, ranges):
    """the queue of the take's render jobs as a manifest the -game process reads (-MoviePipelineConfig=<Saved-relative path>).
    One job per contiguous frame range (MRQ renders ranges)."""
    try: q = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem).get_queue()
    except Exception: q = unreal.new_object(unreal.MoviePipelineQueue)
    q.delete_all_jobs()
    W, H = [int(v) for v in cfg['res'].split('x')]
    for (a, b) in ranges:
        job = q.allocate_new_job(unreal.MoviePipelineExecutorJob)
        sp(job, 'job_name', f"{cfg['shot']}_{a}-{b}")
        sp(job, 'sequence', unreal.SoftObjectPath(seq_path))
        sp(job, 'map', unreal.SoftObjectPath(level))
        c = job.get_configuration()
        o = c.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
        sp(o, 'output_directory', unreal.DirectoryPath(cfg['rawdir']))
        sp(o, 'file_name_format', 'frame_{frame_number}_{render_pass}')
        sp(o, 'zero_pad_frame_numbers', 5)
        sp(o, 'output_resolution', unreal.IntPoint(W, H))
        sp(o, 'override_existing_output', True)
        sp(o, 'use_custom_playback_range', True)
        sp(o, 'custom_start_frame', int(a))
        sp(o, 'custom_end_frame', int(b) + 1)
        sp(o, 'flush_disk_writes_per_shot', True)
        dp = c.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
        if cfg.get('unlit'):   # a diagnosis aid: the albedo as the frame (no lighting)
            c.remove_setting(dp)
            dp = c.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPass_Unlit)
        # the data pass (M_bx_data: region and depth, 32-bit) beside the frame; PNG for the frame (JPEG q95 made from it,
        # like the web takes), EXR for the data
        # ==== R1C (lane C, 2026-10-11): the path-traced preset (tools/ue/render_take_pt.json, cfg pathtrace): Movie Render Queue's
        # path tracer in place of the deferred pass; its samples a pixel are the anti-aliasing setting's spatial samples
        if cfg.get('pathtrace'):
            c.remove_setting(dp)
            dp = c.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPass_PathTracer)
        # ==== R1C end
        data = unreal.MoviePipelinePostProcessPass()
        for k, v in (('enabled', True), ('name', 'Data'), ('material', unreal.load_asset('/Game/Bx/M_bx_data')), ('high_precision_output', True)):
            data.set_editor_property(k, v)
        sp(dp, 'additional_post_process_materials', [data])
        c.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
        c.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_EXR)
        aa = c.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
        sp(aa, 'spatial_sample_count', int(cfg.get('spatial', 1)))
        sp(aa, 'temporal_sample_count', int((cfg.get('cine') or {}).get('temporal') or cfg.get('temporal', 1)))   # R4-CINE: the preset's samples
        sp(aa, 'override_anti_aliasing', True)
        # UE14 (UE track, 2026-10-09): BXUE_AA=none renders each sample without temporal reconstruction (the frame's AA from
        # --spatial samples, the shutter's blur from the temporal ones), a test against TSR's smear of thin alpha-cut leaves
        # (GB43: or the settings' aa 'none', with their spatial samples: a supersampled frame, no TSR smear between samples)
        sp(aa, 'anti_aliasing_method', unreal.AntiAliasingMethod.AAM_NONE if os.environ.get('BXUE_AA') == 'none' or cfg.get('aa') == 'none' else
           unreal.AntiAliasingMethod.AAM_TEMPORAL_AA if cfg.get('aa') == 'taa' else unreal.AntiAliasingMethod.AAM_TSR)   # (FP18: 'taa', the older temporal AA)
        # UE14 end
        # ==== R1C (lane C, 2026-10-11): the path tracer's samples a pixel, no temporal reconstruction
        if cfg.get('pathtrace'):
            sp(aa, 'spatial_sample_count', int(cfg['pathtrace'].get('spp', 128)))
            sp(aa, 'anti_aliasing_method', unreal.AntiAliasingMethod.AAM_NONE)
        # ==== R1C end
        sp(aa, 'render_warm_up_frames', True)
        sp(aa, 'engine_warm_up_count', int(cfg.get('warmup', 48)))
        sp(aa, 'render_warm_up_count', int(cfg.get('warmup', 48)))
        # R9-HANG (UE track, 2026-10-08): real warm-up frames, the sequence played up to the shot. Movie Render Queue's other
        # way (the sequence held through the warm-up, then jumped to the shot with an emulated first-frame motion blur) lost
        # the GPU at the capture's first frame (kernel Xid 109 at engine frame 54) in takes with the trees' wind or the
        # night's light set: t3Fountain 14/14, t8BusGlide 5/5 and the trailer's scBowGolden; with real warm-up frames they
        # render (docs/notes/ar34-ue.md, Crash hunt). BXUE_CUTWARMUP=0 brings the held warm-up back, for tests
        sp(aa, 'use_camera_cut_for_warm_up', os.environ.get('BXUE_CUTWARMUP', '1') != '0')
        cam = c.find_or_add_setting_by_class(unreal.MoviePipelineCameraSetting)
        sp(cam, 'shutter_timing', unreal.MoviePipelineShutterTiming.FRAME_CENTER if cfg.get('cine') else unreal.MoviePipelineShutterTiming.FRAME_CLOSE)   # R4-CINE
        go = c.find_or_add_setting_by_class(unreal.MoviePipelineGameOverrideSetting)
        sp(go, 'cinematic_quality_settings', True)
        sp(go, 'texture_streaming', unreal.MoviePipelineTextureStreamingMethod.DISABLED)
        sp(go, 'use_lod_zero', True)
        sp(go, 'disable_hlods', True)
        sp(go, 'use_high_quality_shadows', True)
        sp(go, 'override_view_distance_scale', True)
        sp(go, 'view_distance_scale', 50)
        sp(go, 'flush_streaming_managers', True)
        cv = c.find_or_add_setting_by_class(unreal.MoviePipelineConsoleVariableSetting)
        for k, v in (cfg.get('cvars') or {}).items():
            cv.add_or_update_console_variable(k, float(v))
    ret = unreal.MoviePipelineEditorLibrary.save_queue_to_manifest_file(q)
    src = next((x for x in (ret if isinstance(ret, (tuple, list)) else [ret]) if isinstance(x, str)), None)
    if not src:
        src = os.path.join(unreal.Paths.project_saved_dir(), 'MovieRenderPipeline', 'QueueManifest.utxt')
    dst_rel = f"MovieRenderPipeline/{cfg['shot']}_{name}.utxt"
    dst = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), dst_rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(unreal.Paths.convert_relative_path_to_full(src) if not os.path.isabs(src) else src, dst)
    q.delete_all_jobs()
    return {'manifest': dst_rel, 'jobs': len(ranges)}


# ======================================================================================================================
# the driver (plain Python)
# ======================================================================================================================
IMPORT_V = 1   # R4-CACHE: bump when the importer's options change


def stage_fingerprint(usd_dir, prep_dir, peds):
    """R4-CACHE: what the stage import depends on: every USD layer (and texture count) of the take's USD dir and of ue_prep's
    output, by name, size and modification time, the walkers' switch and IMPORT_V."""
    import hashlib
    h = hashlib.sha1(f'v{IMPORT_V} peds{int(bool(peds))}'.encode())
    for d, by_content in ((usd_dir, False), (prep_dir, True)):   # (the prep is written again every run: its bytes, not its times)
        for root, _, files in os.walk(d):
            for f in sorted(files):
                if not f.lower().endswith(('.usda', '.usdc', '.usd', '.png', '.jpg', '.hdr')): continue
                q = os.path.join(root, f)
                try: st = os.stat(q)
                except OSError: continue
                if by_content:
                    c = hashlib.sha1()
                    if f.endswith('.usda'):   # (the prep's root layer stamps its time: not part of the stage)
                        c.update(b''.join(l for l in open(q, 'rb') if b'ue_prep =' not in l))
                    else:
                        with open(q, 'rb') as fh:
                            for blk in iter(lambda: fh.read(1 << 22), b''): c.update(blk)
                    h.update(f'{os.path.relpath(q, d)}|{c.hexdigest()}\n'.encode())
                else:
                    h.update(f'{os.path.relpath(q, d)}|{st.st_size}|{int(st.st_mtime)}\n'.encode())
    return h.hexdigest()


def parse_frames(fr, lo, hi):
    if not fr: return list(range(lo, hi + 1))
    out = []
    for part in str(fr).split(','):
        if '-' in part: a, b = part.split('-'); out += list(range(int(a), int(b) + 1))
        elif part: out.append(int(part))
    return sorted(set(f for f in out if lo <= f <= hi))


def ranges_of(frames):
    rs = []
    for f in frames:
        if rs and f == rs[-1][1] + 1: rs[-1][1] = f
        else: rs.append([f, f])
    return rs


CHILD = {}


def _stop(signum, frame):
    """SIGTERM / SIGINT (the batch stopping a take): the engine process is stopped too, by its PID, never orphaned."""
    p = CHILD.get('p')
    if p is not None and p.poll() is None:
        p.terminate()
        try: p.wait(30)
        except subprocess.TimeoutExpired: p.kill()
    sys.exit(1)


def run(cmd, logf, env=None, timeout=None, tag=None):
    t = time.time()
    with open(logf, 'a') as lf:
        lf.write(f"\n### {time.ctime()}\n### {' '.join(cmd)}\n"); lf.flush()
        p = subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT, env=env, cwd=HERE)
        CHILD['p'] = p
        print(f'[ue_take] {tag or cmd[0]}: pid {p.pid}, log {logf}', flush=True)
        try:
            code = p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.terminate()
            try: code = p.wait(30)
            except subprocess.TimeoutExpired: p.kill(); code = p.wait()
            lf.write(f'\n### timeout after {timeout} s\n')
        lf.write(f'\n### exit {code} {time.ctime()}\n')
    return code, round(time.time() - t, 1)


# R9-HANG (UE track, 2026-10-08): the watchdog's safe profile, what a take changes when it runs again after its render lost
# the GPU (ue_take --safe): see docs/notes/ar34-ue.md, Crash hunt
SAFE_PROFILE = {'warmup': 8, 'treewind': 0.0, 'cvars': {'r.Nanite.Tessellation': 0}, 'env': {'BXUE_CUTWARMUP': '1', 'BXUE_EMITSH': '0', 'BXUE_HLGI': '0', 'BXUE_FACNANITE': '0'}}   # (MESH11: no tessellation either, and the facade bake as before: not Nanite, the parallax recess)
LOST_SIGNS = ('VK_ERROR_DEVICE_LOST', 'TerminateOnGPUCrash', 'GPU crash detected', 'DXGI_ERROR_DEVICE_REMOVED', 'DXGI_ERROR_DEVICE_HUNG')


def lost_device(logf, t0, pid=None):
    """the last render's GPU loss, from its log section (the engine's lost-device error and the engine frame it came at) and
    the kernel's Xid records since t0 for the render's process pid (when journalctl may be read); None when the GPU was not
    lost."""
    try:
        lines = open(logf, errors='replace').read().split('\n')
    except OSError:
        return None
    # (the last run's section: from its header, '### <time>' then '### <command>'; run() closes it with '### exit ...')
    hs = [i for i, l in enumerate(lines) if l.startswith('### ') and not l.startswith('### exit')]
    txt = '\n'.join(lines[hs[-1]:] if hs else lines)
    sign = next((s for s in LOST_SIGNS if s in txt), None)
    xid = []
    try:
        since = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(t0))
        out = subprocess.run(['journalctl', '-k', '--since', since, '--no-pager'], capture_output=True, text=True, timeout=20).stdout
        xid = [l.split('NVRM: ', 1)[-1][:160] for l in out.splitlines() if 'Xid' in l and (pid is None or f'pid={pid},' in l)]
    except Exception:
        pass
    if not sign and not xid: return None
    m = None
    if sign:
        i = txt.find(sign); j = txt.rfind('\n', 0, i)
        m = re.search(r'\]\[\s*(\d+)\]', txt[max(0, j - 200):i])
    return {'signature': sign or 'kernel Xid', 'engine_frame': int(m.group(1)) if m else None, 'xid': xid[:4]}


def apply_safe(cfg, log):
    """--safe: SAFE_PROFILE into the take's settings (the warm-up, the trees' wind, the environment its UE processes
    inherit), recorded in the take's stats with the first attempt's loss (BXUE_RETRY_INFO)."""
    if 'warmup' in SAFE_PROFILE: cfg['warmup'] = int(SAFE_PROFILE['warmup'])
    if 'treewind' in SAFE_PROFILE: cfg['treewind'] = SAFE_PROFILE['treewind']
    for k, v in (SAFE_PROFILE.get('cvars') or {}).items(): cfg.setdefault('cvars', {})[k] = float(v)
    os.environ.update({k: str(v) for k, v in (SAFE_PROFILE.get('env') or {}).items()})
    log['safe_profile'] = SAFE_PROFILE
    try: log['retry_of'] = json.loads(os.environ.get('BXUE_RETRY_INFO') or 'null')
    except Exception: log['retry_of'] = None
    print('TAKE_SAFE ' + json.dumps({'profile': SAFE_PROFILE, 'retry_of': log['retry_of']}), flush=True)


GPU_LOCKS = os.environ.get('BXUE_GPU_LOCKS', '/data0/projectnyc_aux/tmp/ue_gpu_locks')


def gpu_lock(gpu, log):
    """the render's GPU, held exclusively (flock) until this process ends or execs: the physical GPU named by DRI_PRIME,
    else UE's adapter index (adapter 0 without DRI_PRIME is PCI 61 on this machine); a take on a busy GPU waits."""
    import fcntl
    dp = os.environ.get('DRI_PRIME', '')
    key = dp if dp.startswith('pci-') else {'0': 'pci-0000_61_00_0'}.get(str(gpu), f'adapter-{gpu}')
    os.makedirs(GPU_LOCKS, exist_ok=True)
    f = open(os.path.join(GPU_LOCKS, f'{key}.lock'), 'a+')
    t = time.time()
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.seek(0); held = f.read().strip()[:120]
        print(f'[ue_take] GPU {key} is busy ({held or "another engine"}); waiting for it', flush=True)
        fcntl.flock(f, fcntl.LOCK_EX)
    f.seek(0); f.truncate(); f.write(f'pid {os.getpid()} {time.ctime()} {log.get("shot")}'); f.flush()
    log['gpu'] = key; log['gpu_wait_s'] = round(time.time() - t, 1)
    return f
# R9-HANG end


def main():
    import argparse, signal
    signal.signal(signal.SIGTERM, _stop); signal.signal(signal.SIGINT, _stop)
    ap = argparse.ArgumentParser()
    ap.add_argument('--usd', required=True)
    ap.add_argument('--frames'); ap.add_argument('--outdir'); ap.add_argument('--work')
    ap.add_argument('--res', default='2560x1440'); ap.add_argument('--gpu', default='0')
    ap.add_argument('--overwrite', action='store_true'); ap.add_argument('--noimport', action='store_true')
    ap.add_argument('--norender', action='store_true'); ap.add_argument('--noprep', action='store_true')
    # (R9-HANG: 48 real warm-up frames. With 8, t8BusGlide rendered 3 of 3 (with 48 it lost the GPU at the capture's first
    # frame in 4 of 8 runs, the watchdog recovering each), but Nanite's streaming is not done after 8 frames: frame 0 shows
    # the trees at their coarse levels (large flat leaf polygons). --warmup 8 for a heavy night take whose cut drops frame 0)
    ap.add_argument('--warmup', default='48'); ap.add_argument('--spatial', default='1'); ap.add_argument('--temporal', default='1')
    ap.add_argument('--mblur', default='0.5'); ap.add_argument('--ev', default=None)
    ap.add_argument('--nort', action='store_true', help='no hardware ray tracing (software Lumen, MegaLights off)')
    ap.add_argument('--nomegalights', action='store_true'); ap.add_argument('--peds', action='store_true')
    ap.add_argument('--quality', default='95'); ap.add_argument('--timeout', default='5400')
    ap.add_argument('--nolights', action='store_true'); ap.add_argument('--nomat', action='store_true')
    ap.add_argument('--cvar', action='append', default=[], help='k=v console variables for the render (repeatable)')
    ap.add_argument('--unlit', action='store_true', help='render the albedo without lighting (a diagnosis aid)')
    ap.add_argument('--treewind', default=None, help='TREEUE: the trees\' wind strength (0 freezes it; default 1, or BXUE_TREEWIND)')
    ap.add_argument('--light', default='phys', choices=('phys', 'web'), help='R3-PHYS: physical light (phys_light.json) or the web-matched rig')
    ap.add_argument('--raylight', default='HIT_LIGHTING_FOR_REFLECTIONS', help='R3-PHYS: Lumen ray lighting (HIT_LIGHTING, HIT_LIGHTING_FOR_REFLECTIONS, SURFACE_CACHE)')
    ap.add_argument('--fgq', default='2.0', help='R3-PHYS: Lumen final gather quality')
    # R4-CINE: the cinematic preset (Movie Render Queue's temporal samples over a 180 deg shutter centred on the frame, depth
    # of field on the take's subject, the web's bloom, grain, a deeper vignette, light volumetric fog); --cinetemporal,
    # --fstop, --grain, --fog (x the time of day's density, 0 off), --focusfrom <depth dir> (default: the shot's UE take)
    ap.add_argument('--cine', action='store_true'); ap.add_argument('--cinetemporal', default='8')
    ap.add_argument('--fstop', default='2.8'); ap.add_argument('--grain', default='0.035'); ap.add_argument('--fog', default='1.0')
    ap.add_argument('--focusfrom', default=None)
    # R4-PEDS: the take's walkers (usd_peds.py's UsdSkel layer, <shot>_peds.usda) by default when the USD dir has them
    ap.add_argument('--nopeds', action='store_true')
    ap.add_argument('--reimport', action='store_true', help='R4-CACHE: import the stage again even when its fingerprint matches')
    ap.add_argument('--safe', action='store_true', help='R9-HANG: render with SAFE_PROFILE (the watchdog\'s retry after a lost GPU)')
    a = ap.parse_args()
    usd = os.path.abspath(a.usd)
    shot = os.path.splitext(os.path.basename(usd))[0].replace('_peds', '')
    if not a.nopeds and os.path.exists(usd.replace('.usda', '_peds.usda')): a.peds = True   # R4-PEDS
    work = os.path.abspath(a.work or os.path.join('/data0/projectnyc_aux/tmp/ue', shot))
    outdir = os.path.abspath(a.outdir or os.path.join(ROOT, 'client', 'shots', 'ad', 'clips_ue', shot))
    prep = os.path.join(work, 'prep')
    os.makedirs(work, exist_ok=True); os.makedirs(outdir, exist_ok=True)
    log = {'shot': shot, 'usd': usd, 'res': a.res, 'engine': UE_ROOT, 'started': time.ctime()}
    side_p = os.path.join(prep, f'ue_{shot}.json')

    # 1. prep
    if not a.noprep or not os.path.exists(side_p):
        cmd = ['uv', 'run', '--no-project', '--with', 'usd-core', '--with', 'numpy', '--with', 'pillow', '--with', 'scipy', 'python', os.path.join(HERE, 'ue_prep.py'), '--usd', usd, '--out', prep]
        if a.peds:
            pr = usd.replace('.usda', '_peds.usda')
            if os.path.exists(pr): cmd += ['--root', pr]
        code, secs = run(cmd, os.path.join(work, 'prep.log'), tag='prep')
        log['prep_s'] = secs
        if code != 0 or not os.path.exists(side_p): print('[ue_take] prep failed', code); sys.exit(2)
    side = json.load(open(side_p))
    # one run of a shot at a time: its assets (/Game/Takes/<shot>) are deleted and rebuilt by every import
    # (R9-TEX test aid: BXUE_TAKENAME, the take's UE name (its assets, map, lock, manifests) for a test take of a shot another
    # track renders; the prep and the harvest keep the shot's own name)
    if os.environ.get('BXUE_TAKENAME'): shot = log['shot'] = os.environ['BXUE_TAKENAME']
    import fcntl
    lockf = open(os.path.join(os.path.dirname(PROJECT), 'Saved', f'take_{shot}.lock'), 'w')
    try: fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError: print(f'[ue_take] {shot} is being rendered by another process (Saved/take_{shot}.lock)'); sys.exit(5)
    lo, hi = side['frames']
    frames = parse_frames(a.frames, lo, hi)
    todo = frames if a.overwrite else [f for f in frames if not os.path.exists(os.path.join(outdir, f'frame_{f:05d}.jpg'))]
    log['frames'] = len(frames)
    rawdir = os.path.join(work, 'raw')
    # pre-exposure off: the scene colour is radiance, so M_bx_film's exposure is the page's own whatever UE's exposure does
    cvars = {'r.MotionBlurQuality': 4, 'r.EyeAdaptation.PreExposureOverride': 1}
    # R5-HANG: no async compute in any take: the GPU hung (kernel Xid 109, a context-switch timeout between the render's
    # graphics and async-compute channels) in cinematic and plain night takes alike, at random; on one queue it has not
    # (BXUE_ASYNC=1 brings it back, for tests)
    if not os.environ.get('BXUE_ASYNC'): cvars['r.RDG.AsyncCompute'] = 0
    # R5-HANG: and no per-frame ray-tracing rebuilds of the moving crowd and the wind: the walkers' 634 skinned meshes out
    # of the ray-tracing scene and the skin cache (they skin in their vertex shaders; Lumen lights and reflects without
    # them, the sun's shadow maps keep their shadows), the trees' wind not evaluated for ray tracing (Lumen sees the crowns
    # at rest). With async compute alone off a plain golden take still hung (22:18, RayTracingGeometry among the active
    # passes at the hang before it)
    # R9-HANG (UE track, 2026-10-08): the walkers skin in the skin cache again (a compute pass per frame into a position
    # buffer every draw reads), still out of ray tracing. With vertex-shader skinning (the skin cache off, R5) a park take
    # rendered from frame 0 lost the GPU at its first captured frames in 2 of 4 runs, the device fault an invalid read; with
    # the skin cache 5 of 5 rendered, the frames the same to within 0.3 grey levels (docs/notes/ar34-ue.md, Crash hunt)
    if not os.environ.get('BXUE_RTDYN'):
        cvars.update({'r.RayTracing.Geometry.SkeletalMeshes': 0, 'r.SkinCache.Mode': 1, 'r.RayTracing.Geometry.StaticMeshes.WPO': 0,
                      'r.RayTracing.Geometry.InstancedStaticMeshes.EvaluateWPO': 0, 'r.RayTracing.Geometry.NaniteProxies.WPO': 0})
    # MESH11 (UE track, 2026-10-08): room for the displacement's patches. Tessellation splits each displaced triangle
    # into patches; at the default 2097152 a street take with the facades' inset ran out and whole triangles of the
    # ground and the walls dropped from the frame (the night sky through the road); four times that renders whole
    cvars.update({'r.Nanite.MaxCandidatePatches': 8388608, 'r.Nanite.MaxVisiblePatches': 8388608})
    # and the shadow maps draw the surfaces undisplaced: with tessellation in the virtual shadow maps the facade bake (when
    # Nanite, BXUE_FACNANITE) dropped out of the sun's shadow and Bryant Park's allee stood in low sun the web keeps in
    # shade; without it the bake shades the park as before (the relief's own sun shadow is the price, a centimetre or two)
    cvars.update({'r.Shadow.Virtual.Nanite.AllowTessellationDirectional': 0, 'r.Shadow.Virtual.Nanite.AllowTessellationLocal': 0})
    # MESH11 end
    for kv in a.cvar:
        k, v = kv.split('='); cvars[k] = float(v)
    cfg = {'shot': shot, 'side': side_p, 'res': a.res, 'ranges': ranges_of(todo) or [[lo, lo]], 'rawdir': rawdir,
           'warmup': int(a.warmup), 'spatial': int(a.spatial), 'temporal': int(a.temporal), 'mblur': float(a.mblur),
           'ev': None if a.ev is None else float(a.ev), 'nort': a.nort, 'megalights': not (a.nomegalights or a.nort),
           'peds': a.peds, 'import': not a.noimport, 'import_json': os.path.join(work, 'import.json'),
           'nolights': a.nolights, 'nomat': a.nomat, 'cvars': cvars, 'unlit': a.unlit, 'light': a.light, 'raylight': a.raylight, 'fgq': float(a.fgq)}
    cfg['treewind'] = a.treewind   # TREEUE: the trees' wind (ue_trees.py; 0 freezes it)
    if a.safe: apply_safe(cfg, log)   # R9-HANG
    if a.cine:   # R4-CINE: the preset, and the subject's distance per frame from the shot's own depth
        cfg['cine'] = {'temporal': int(a.cinetemporal), 'fstop': float(a.fstop), 'grain': float(a.grain), 'fog': float(a.fog), 'focus': {}}
        # (R5-HANG: async compute, the walkers in ray tracing, the skin cache and the wind in ray tracing are off in every
        # take, above)
        dd = a.focusfrom or next((d for d in (os.path.join(outdir, '_depth'), os.path.join(ROOT, 'client', 'shots', 'ad', 'clips_ue', shot, '_depth'))
                                  if os.path.isdir(d) and any(f.startswith('depth_') for f in os.listdir(d))), None)
        if dd:
            fj = os.path.join(work, 'focus.json')
            code, _ = run(['uv', 'run', '--no-project', '--with', 'numpy', '--with', 'pillow', 'python', os.path.join(HERE, 'ue_frames.py'),
                           '--focus', dd, '--json', fj], os.path.join(work, 'focus.log'), tag='focus')
            try: cfg['cine']['focus'] = json.load(open(fj)).get('focus') or {}
            except Exception: pass
        log['cine'] = {k: v for k, v in cfg['cine'].items() if k != 'focus'}; log['cine']['focus_frames'] = len(cfg['cine']['focus'])
    cfg_p = os.path.join(work, 'run.json'); json.dump(cfg, open(cfg_p, 'w'), indent=1)
    rt = [] if not a.nort else ['-ini:Engine:[/Script/Engine.RendererSettings]:r.RayTracing=False,[/Script/Engine.RendererSettings]:r.Lumen.HardwareRayTracing=False']
    # the editor binaries per platform (Windows: Win64 and .exe; tested on Linux only)
    _bin, _ext = ('Win64', '.exe') if sys.platform == 'win32' else ('Linux', '')
    editor_cmd = os.path.join(UE_ROOT, 'Engine', 'Binaries', _bin, 'UnrealEditor-Cmd' + _ext)
    editor = os.path.join(UE_ROOT, 'Engine', 'Binaries', _bin, 'UnrealEditor' + _ext)

    # 2. import (also when only the frames change: the manifest carries the frame ranges), unless --noimport finds an import
    # of this prep whose 'all' manifest covers the frames asked for
    if not todo:
        print('[ue_take] every frame exists (--overwrite renders them again)'); return
    manifest = None
    if a.noimport and os.path.exists(cfg['import_json']) and os.path.getmtime(cfg['import_json']) > os.path.getmtime(side_p):
        imp = json.load(open(cfg['import_json']))
        if todo == list(range(lo, hi + 1)) and 'all' in (imp.get('mrq') or {}):
            manifest = imp['mrq']['all']['manifest']; log['import'] = imp; log['import_s'] = 0; log['import_reused'] = True
    if manifest is None:
      if os.path.exists(cfg['import_json']): os.remove(cfg['import_json'])   # an older run's result is never taken for this one's
      # R4-CACHE: the stage's fingerprint (every layer of the take's USD dir and of the prep: name, size, mtime; the walkers'
      # switch; IMPORT_V for the importer's options); the same one beside the previous import keeps that import's stage
      old = os.path.join(os.path.dirname(PROJECT), 'Content', 'Takes', shot)
      fp_file = os.path.join(old, '.bx_stage_fp')
      fp = stage_fingerprint(os.path.dirname(usd), prep, a.peds)
      if not a.reimport and os.path.exists(fp_file) and open(fp_file).read().strip() == fp and os.path.exists(os.path.join(old, f'L_{shot}.umap')):
        cfg['reuse_stage'] = True; json.dump(cfg, open(cfg_p, 'w'), indent=1); log['stage_reused'] = True; log['delete_s'] = 0.0
      else:
        # the previous import of this shot goes before the engine starts: deleting its ~3,500 packages inside the editor took
        # 350 s of a 450 s import (reference checks per asset); on disk, under the shot's lock, it takes a second
        t_del = time.time()
        if os.path.isdir(old): shutil.rmtree(old)
        log['delete_s'] = round(time.time() - t_del, 1)
      code, secs = run([editor_cmd, PROJECT, '-run=pythonscript', f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash',
                      '-nullrhi', '-stdout', '-FullStdOutLogOutput', '-NoLogTimes'] + rt,
                     os.path.join(work, 'import.log'), env=ue_env({'BXUE_CFG': cfg_p}), timeout=int(a.timeout), tag='import')
      log['import_s'] = secs
      try: log['import'] = json.load(open(cfg['import_json'])); manifest = log['import']['mrq']['run']['manifest']
      except Exception: pass
      try:   # R4-CACHE: the stage this import made, for the next run of the shot
        if manifest and not (log.get('import') or {}).get('error') and os.path.isdir(old): open(fp_file, 'w').write(fp)
      except Exception: pass
      try: manifest = log['import']['mrq']['run']['manifest']
      except Exception:
          err = (log.get('import') or {}).get('error') if isinstance(log.get('import'), dict) else None
          print('[ue_take] import failed', code, err or '(import.log)'); json.dump(log, open(os.path.join(work, 'take_ue_failed.json'), 'w'), indent=1); sys.exit(3)
    if a.norender: json.dump(log, open(os.path.join(work, 'take_ue.json'), 'w'), indent=1); return

    # 3. render
    # R9-HANG (UE track, 2026-10-08): one engine per GPU. Two renders on one GPU make the driver switch between their
    # contexts, and a long frame that cannot be preempted loses the device (Xid 109: three takes at once on GPU 0); a take
    # waits here for the GPU's lock (outside the repo, shared by every copy of this file) and holds it while it renders
    gl = gpu_lock(a.gpu, log)
    shutil.rmtree(rawdir, ignore_errors=True); os.makedirs(rawdir, exist_ok=True)
    W, H = a.res.split('x')
    t_r = time.time()
    code, secs = run([editor, PROJECT, 'MoviePipelineEntryMap', '-game', f"-MoviePipelineConfig={manifest}",
                      '-RenderOffscreen', '-Unattended', '-NoSplash', '-NoLoadingScreen', '-nosound', '-windowed', f'-resx={W}', f'-resy={H}',
                      f'-graphicsadapter={a.gpu}', '-log', '-stdout', '-FullStdOutLogOutput', '-NoTextureStreaming'] + rt
                     + os.environ.get('BXUE_RENDER_ARGS', '').split(),   # (R9-HANG: a test aid, extra engine arguments)
                     os.path.join(work, 'render.log'), env=ue_env(), timeout=int(a.timeout), tag='render')
    log['render_s'] = secs; log['render_exit'] = code
    # R9-HANG (UE track, 2026-10-08): the lost-device watchdog. A render that lost the GPU (the engine's VK_ERROR_DEVICE_LOST
    # or its GPU-crash exit in render.log, a kernel Xid during the run) is said so in the take's stats and on its own line,
    # and run once more, whole, with SAFE_PROFILE (--safe); a safe run that fails again exits non-zero
    lost = lost_device(os.path.join(work, 'render.log'), t_r, getattr(CHILD.get('p'), 'pid', None)) if code != 0 else None
    if lost:
        log['device_lost'] = lost
        print('TAKE_DEVICE_LOST ' + json.dumps(lost), flush=True)
        if not a.safe and not os.environ.get('BXUE_NOWATCHDOG'):
            info = {'first': lost, 'profile': SAFE_PROFILE, 'render_s': secs}
            print('[ue_take] the render lost the GPU; running the take once more with the safe profile ' + json.dumps(SAFE_PROFILE), flush=True)
            json.dump(log, open(os.path.join(work, 'take_ue_device_lost.json'), 'w'), indent=1)
            try: fcntl.flock(lockf, fcntl.LOCK_UN); lockf.close()
            except Exception: pass
            try: fcntl.flock(gl, fcntl.LOCK_UN); gl.close()
            except Exception: pass
            sys.stdout.flush(); sys.stderr.flush()
            # (the safe run imports again, its warm-up and wind are the import's: never --noimport)
            os.execve(sys.executable, [sys.executable, os.path.abspath(__file__)] + [x for x in sys.argv[1:] if x != '--noimport'] + ['--safe'],
                      dict(os.environ, BXUE_RETRY_INFO=json.dumps(info)))
    # R9-HANG end
    # the frames: ue_frames.py turns the raw passes into the take's frame_%05d.jpg (JPEG q95 from the PNG), _ue/regions/
    # (the data pass's regions, 8-bit) and _depth/ (depth_%04d.png and cams.json, as blender_take.py writes them for
    # bx_leafcheck.py); per-frame seconds from the files' times (the first includes the map load, shader compiles, warm-up)
    fj = os.path.join(work, 'frames.json')
    fcode, fsecs = run(['uv', 'run', '--no-project', '--with', 'numpy', '--with', 'pillow', '--with', 'OpenEXR', 'python', os.path.join(HERE, 'ue_frames.py'),
                        '--raw', rawdir, '--out', outdir, '--side', side_p, '--res', a.res, '--quality', str(a.quality), '--t0', str(t_r), '--json', fj],
                       os.path.join(work, 'frames.log'), env=dict(os.environ), tag='frames')
    try: fr = json.load(open(fj))
    except Exception: fr = {'per_frame': []}
    log['frames_s'] = fsecs
    per = fr.get('per_frame', [])
    for rec in per: print('TAKE_FRAME ' + json.dumps(rec), flush=True)
    secs_ = [r['secs'] for r in per]
    log['per_frame'] = per
    log['first_frame_s'] = secs_[0] if secs_ else None
    rest = sorted(secs_[1:])
    log['mean_frame_s'] = round(sum(rest) / len(rest), 3) if rest else None
    log['median_frame_s'] = rest[len(rest) // 2] if rest else None
    log['missing'] = [f for f in todo if not os.path.exists(os.path.join(outdir, f'frame_{f:05d}.jpg'))]
    name = 'take_ue.json' if not a.frames else f'take_ue_{frames[0]}-{frames[-1]}.json'
    json.dump(log, open(os.path.join(outdir, name), 'w'), indent=1)
    print('TAKE_STATS ' + json.dumps({k: v for k, v in log.items() if k not in ('per_frame', 'import')}), flush=True)
    if log['missing']: sys.exit(4)


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401  (inside the engine)
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    if IN_ENGINE: in_engine()
    else: main()
