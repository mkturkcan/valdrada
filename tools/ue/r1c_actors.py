#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): a take's moving actors (vehicles, walkers, trains, the lens) brought into a persistent world
# (tools/ue/r1c_cells.py) without importing the static city again: the take's actor layers only (the moving-set layer,
# the walkers, the camera, with the prototypes' geometry and looks layers they reference), in the world's absolute frame
# (the take root's recentring left out), prepared by ue_prep.py, imported into a streaming sublevel of the
# world (always loaded), materials by ue_mat.py, the take's sequence (the importer's as a subsequence, the lens keyed
# from the prep, the pre-roll) and a Movie Render Queue manifest on the world's level; then one -game process renders.
#   python3 tools/ue/r1c_actors.py --world-level /Game/R1C/W_cplake/L_cplake --shot scLakeGolden --template <root.usda>
#       --layers cam.usda,mov.usdc,peds.usdc,looks.usdc,geo.usdc --run <run.json> --out <dir> [--frames a-b] [--norender]
import json, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')


def in_engine():
    import unreal, traceback
    for p in (EXPORT, os.path.join(EXPORT, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    import importlib, ue_take, ue_mat, ue_light
    for m in (ue_mat, ue_light): importlib.reload(m)
    C = json.load(open(os.environ['R1C_ACT_CFG']))
    side = json.load(open(C['side']))
    run = json.load(open(C['run']))
    eal = unreal.EditorAssetLibrary
    atools = unreal.AssetToolsHelpers.get_asset_tools()
    T = {}
    t0 = time.time()
    shot, world_level = C['shot'], C['world_level']
    dest = f"/Game/R1C/Act/{shot}{C.get('tag') or ''}"
    sub_path = f"{dest}/L_act_{shot}{C.get('tag') or ''}"
    if C.get('new_level_with'):   # (the take's own level made in this session: a new map holding the world's levels)
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
        w_ = unreal.EditorLevelLibrary.get_editor_world()
        if C.get('cell_tables'):   # (GB43 KIT: the cells' kit instances as cell actors reading their tables at play; ValdradaCells)
            # (spawned before any level is added, so into the take's own map: added after, they went into the current level,
            # the last far package added, and were saved with it, a shared level every later world loaded)
            ccls = unreal.load_class(None, '/Script/ValdradaCells.ValdradaCell')
            n_ = 0
            for tp in json.load(open(C['cell_tables'])):
                ca = unreal.EditorLevelLibrary.spawn_actor_from_class(ccls, unreal.Vector(0, 0, 0))
                ca.set_editor_property('table_path', tp); ca.set_actor_label('cell_' + os.path.basename(tp).split('.')[0]); n_ += 1
            T['cell_actors'] = n_
        for lv in C['new_level_with']: unreal.EditorLevelUtils.add_level_to_world(w_, lv, unreal.LevelStreamingAlwaysLoaded)
        unreal.EditorLoadingAndSavingUtils.save_map(w_, world_level)
    else:
        unreal.EditorLoadingAndSavingUtils.load_map(world_level)
    T['load_world_s'] = round(time.time() - t0, 1)
    world = unreal.EditorLevelLibrary.get_editor_world()
    # the take's sublevel (a re-run replaces it)
    t = time.time()
    try:
        streaming = unreal.EditorLevelUtils.create_new_streaming_level(unreal.LevelStreamingAlwaysLoaded, sub_path, False)
        try: unreal.EditorLevelUtils.make_level_current(streaming)
        except Exception:
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).set_current_level_by_name(sub_path.split('/')[-1])
        T['sublevel'] = sub_path
    except Exception as e:
        T['sublevel_error'] = f'{type(e).__name__}: {e}'
    opts = unreal.UsdStageImportOptions()
    for k, v in (('import_actors', True), ('import_geometry', True), ('import_skeletal_animations', bool(C.get('peds'))), ('import_level_sequences', True),
                 ('import_materials', True), ('import_only_used_materials', True), ('purposes_to_import', 2), ('nanite_triangle_threshold', 1),
                 ('share_assets_for_identical_prims', True), ('merge_identical_material_slots', False), ('prim_path_folder_structure', False),
                 ('existing_actor_policy', unreal.ReplaceActorPolicy.REPLACE), ('existing_asset_policy', unreal.ReplaceAssetPolicy.REPLACE),
                 ('use_prim_kinds_for_collapsing', False)):
        try: opts.set_editor_property(k, v)
        except Exception as e: T.setdefault('option_misses', []).append(f'{k}: {e}')
    task = unreal.AssetImportTask()
    for k, v in (('filename', side['ue_root']), ('destination_path', dest), ('automated', True), ('replace_existing', True), ('save', False), ('options', opts)):
        task.set_editor_property(k, v)
    atools.import_asset_tasks([task])
    T['import_s'] = round(time.time() - t, 1)
    T['imported_objects'] = len(task.get_editor_property('imported_object_paths') or [])
    # materials (vehicles' paint, walkers): the take's own hook
    t = time.time()
    try: T['mat'] = {k: v for k, v in (ue_mat.apply(side, dest, run) or {}).items() if k in ('by_kind', 'assets', 'walkers', 'paint', 'secs')}
    except Exception as e: T['mat_error'] = f'{type(e).__name__}: {e}'; unreal.log_error('[r1c] mat: ' + traceback.format_exc())
    T['mat_s'] = round(time.time() - t, 1)
    # the sequence: the importer's (the actors' tracks) as a subsequence, the lens keyed from the prep, the pre-roll
    t = time.time()
    nF = side['frames'][1] - side['frames'][0] + 1
    tq = time.time()
    lsd = f'{dest}/LevelSequences'   # (the importer's sequences live there: listing the whole import, 2,000-4,000 assets, took 90 s)
    seqs = [a for a in (eal.list_assets(lsd, recursive=True, include_folder=False) if eal.does_directory_exist(lsd) else eal.list_assets(dest, recursive=True, include_folder=False))
            if '/LevelSequences/' in a and eal.find_asset_data(a).asset_class_path.asset_name == 'LevelSequence']
    T['seq_list_s'] = round(time.time() - tq, 1)
    stem = os.path.splitext(os.path.basename(side['ue_root']))[0]
    pick = next((a for a in seqs if a.split('/')[-1].split('.')[0] in ('LS_' + stem, stem)), seqs[0] if seqs else None)
    tq = time.time()
    root_seq = eal.load_asset(pick) if pick else None
    T['seq_load_s'] = round(time.time() - tq, 1); tq = time.time()
    els = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    ue_light.els = els
    cam = ue_light.take_camera(side, run)
    T['seq_cam_s'] = round(time.time() - tq, 1); tq = time.time()
    ls_path = f'{dest}/LS_{shot}'
    if eal.does_asset_exist(ls_path): eal.delete_asset(ls_path)
    ls = atools.create_asset(f'LS_{shot}', dest, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    T['seq_create_s'] = round(time.time() - tq, 1)
    ls.set_display_rate(unreal.FrameRate(int(round(side.get('fps') or 30)), 1)); ls.set_playback_start(0); ls.set_playback_end(nF)
    if root_seq is not None:
        sub = ls.add_track(unreal.MovieSceneSubTrack); sec = sub.add_section(); sec.set_sequence(root_seq); sec.set_range(0, nF)
    cb = ls.add_possessable(cam)
    cut = ls.add_track(unreal.MovieSceneCameraCutTrack); cs = cut.add_section(); cs.set_range(0, nF)
    try: bid = unreal.MovieSceneSequenceExtensions.get_portable_binding_id(ls, ls, cb)
    except Exception: bid = ls.get_binding_id(cb)
    cs.set_camera_binding_id(bid)
    tq = time.time()
    # (the lens is this tool's own BX_Camera, keyed from the prep: the importer's camera tracks in the subsequences are not
    # its, so they need no scan; ue_take's take still scans them for the importer's camera)
    T['camera'] = ue_light.camera_settings(cam, side, run, () if cam.get_actor_label() == 'BX_Camera' else (ue_take.sub_sequences(unreal, root_seq) if root_seq else ()))
    T['camera_s'] = round(time.time() - tq, 1); tq = time.time()
    T['camera_keys'] = ue_light.key_camera(ls, cb, side)
    T['keys_s'] = round(time.time() - tq, 1)
    # the take's night for the cells' materials (r1c_cellmat2.py: MPC_r1c.Night), one key held over the whole take, as
    # three.js's ENV.night: night-only parts, the room fills' dimming, the interiors' own light, the signs' lamps
    try:
        nv = None
        if C.get('light_harvest') and os.path.exists(os.path.join(C['light_harvest'], 'light_static.json')):
            ls_ = json.load(open(os.path.join(C['light_harvest'], 'light_static.json')))
            nv = float(ls_.get('night', 1.0 if ls_.get('mode') == 'night' else 0.0) or 0.0)
        if nv is not None and eal.does_asset_exist('/Game/Bx/MPC_r1c'):
            tr_ = ls.add_track(unreal.MovieSceneMaterialParameterCollectionTrack)
            tr_.set_editor_property('mpc', eal.load_asset('/Game/Bx/MPC_r1c'))
            sc_ = tr_.add_section()
            try: sc_.set_start_frame_bounded(False); sc_.set_end_frame_bounded(False)
            except Exception: sc_.set_range(-100000, nF + 100000)
            sc_.add_scalar_parameter_key('Night', unreal.FrameNumber(0), nv)
            T['night_key'] = nv
    except Exception as e:
        T['night_key_error'] = f'{type(e).__name__}: {e}'; unreal.log_error('[r1c] night key: ' + traceback.format_exc())
    if run.get('cine'):
        try: T['focus'] = ue_light.key_focus(ls, cam, side, run)
        except Exception as e: T['focus_error'] = str(e)[:160]
    tq = time.time()
    # (speed, 2026-10-19: the pre-roll starts its warm-up frames before THIS take's range, not before frame 0: a range at
    # 1423 warmed up through 1,487 frames, 670 s of a 5,190 s render)
    try: T['preroll'] = ue_take.preroll(unreal, ls, root_seq, dict(run, ranges=[C['frames']]) if C.get('frames') else run)
    except Exception as e: T['preroll_error'] = f'{type(e).__name__}: {e}'
    T['preroll_s'] = round(time.time() - tq, 1)
    tq = time.time()
    eal.save_loaded_asset(ls)
    T['seq_save_s'] = round(time.time() - tq, 1)
    T['seq_s'] = round(time.time() - t, 1)
    if C.get('light_harvest'):   # (the take's light in this session, into the actors' sublevel: as r1c_relight.py, one editor start fewer)
        t = time.time()
        try:
            import ue_light as ul
            importlib.reload(ul); ul.els = els
            kept = []
            for a_ in els.get_all_level_actors():
                if a_.get_actor_label() == 'BX_Camera': a_.set_actor_label('R1C_keep_camera'); kept.append(a_)
            sideL = dict(side); sideL['data'] = dict(side['data'], harvest=C['light_harvest'])
            sideL['emit_lights'] = []
            lo_ = ul.apply(sideL, f'{dest}/Light', run, world) or {}
            for a_ in kept: a_.set_actor_label('BX_Camera')
            T['light'] = {k: lo_.get(k) for k in ('mode', 'night', 'lamps', 'headlamps', 'film')}
        except Exception as e:
            T['light_error'] = f'{type(e).__name__}: {e}'; unreal.log_error('[r1c] light: ' + traceback.format_exc())
        T['light_s'] = round(time.time() - t, 1)
    t = time.time()
    eal.save_directory(dest, only_if_is_dirty=True, recursive=True)
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    T['save_s'] = round(time.time() - t, 1)
    cfg = dict(run, shot=f'act_{shot}', rawdir=C['out'])
    lo, hi = side['frames']
    T['mrq'] = ue_take.mrq_manifest(unreal, cfg, side, world_level, ls.get_path_name(), 'act', [C.get('frames') or [lo, hi]])
    T['secs'] = round(time.time() - t0, 1)
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[r1c] ACT_DONE ' + json.dumps(T)[:3000])


def write_root(template, layers, out_root, shot, origin):
    """the actor-only root: the take root's data, /World translated by the take's origin, the given layers"""
    from pxr import Sdf, Gf
    tl = Sdf.Layer.FindOrOpen(template)
    if os.path.exists(out_root): os.remove(out_root)
    L = Sdf.Layer.CreateNew(out_root)
    for k in ('startTimeCode', 'endTimeCode', 'timeCodesPerSecond', 'framesPerSecond'):
        try: setattr(L, k, getattr(tl, k))
        except Exception: pass
    cld = dict(tl.customLayerData); cld['r1c_actors'] = {'from': template, 'origin_applied': Gf.Vec3d(*[float(v) for v in origin])}
    cld['origin'] = Gf.Vec3d(0.0, 0.0, 0.0)   # (the layer's content now sits in the world's absolute frame)
    L.customLayerData = cld
    L.subLayerPaths = [os.path.abspath(x) for x in layers]
    L.defaultPrim = 'World'
    # (no recentring: the export's layers, and lane D's tracks, are in the world's absolute frame; the take root's
    # xformOp:translate:recentre by -origin is what made them shot-local, and it is left out here)
    Sdf.PrimSpec(L, 'World', Sdf.SpecifierDef, 'Xform')
    # (the root's metadata: up axis Y, metres, as the take's)
    L.pseudoRoot.SetInfo('upAxis', tl.pseudoRoot.GetInfo('upAxis') if tl.pseudoRoot.HasInfo('upAxis') else 'Y')
    L.pseudoRoot.SetInfo('metersPerUnit', tl.pseudoRoot.GetInfo('metersPerUnit') if tl.pseudoRoot.HasInfo('metersPerUnit') else 1.0)
    L.Save()
    return cld


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--world-level', required=True); ap.add_argument('--shot', required=True); ap.add_argument('--template', required=True)
    ap.add_argument('--layers', required=True); ap.add_argument('--run', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--frames', default=None); ap.add_argument('--norender', action='store_true'); ap.add_argument('--gpu-pci', default='01')
    ap.add_argument('--res', default='2560x1440'); ap.add_argument('--stage', default='all', help='root, prep, import or render to start there')
    ap.add_argument('--tag', default='', help='a suffix for the take\'s content folder and sublevel (a re-run beside an earlier one)')
    ap.add_argument('--new-level-with', default=None, help='comma-separated levels: make --world-level a new map holding them (the take level)')
    ap.add_argument('--cell-tables', default=None, help='GB43 KIT: a json list of cell tables, a cell actor each in the take level')
    ap.add_argument('--light-harvest', default=None, help='the light pass to light the take with in the same session')
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    rec = json.load(open(os.path.join(out, 'actors.json'))) if os.path.exists(os.path.join(out, 'actors.json')) else {}
    rec['started_' + a.stage] = time.ctime()
    layers = [os.path.abspath(x) for x in a.layers.split(',')]
    root = os.path.join(out, 'root', f'{a.shot}.usda'); os.makedirs(os.path.dirname(root), exist_ok=True)
    prep = os.path.join(out, 'prep')
    order = ['root', 'prep', 'import', 'render']
    first = 0 if a.stage == 'all' else order.index(a.stage)
    if first <= 0:
        from pxr import Sdf
        tl = Sdf.Layer.FindOrOpen(a.template)
        origin = tuple(tl.customLayerData.get('origin') or (0, 0, 0))
        t = time.time(); write_root(a.template, layers, root, a.shot, origin); rec['root_s'] = round(time.time() - t, 1); rec['origin'] = list(origin)
        # (the take's side files beside the root, as usd_trees.py --retake links them: peds_<shot>.npz, bx_fix.json, textures/)
        tdir = os.path.dirname(os.path.abspath(a.template))
        for nm in os.listdir(tdir):
            src, dst = os.path.join(tdir, nm), os.path.join(os.path.dirname(root), nm)
            if os.path.lexists(dst) or nm.endswith(('.usda', '.usdc', '.usd')): continue
            os.symlink(src, dst)
    if first <= 1:
        # (speed, 2026-10-19: the prep depends only on the shot's root (its layers and origin), the layers and ue_prep.py,
        # not on the take's range or preset, and took 300 s of every 800 s take: kept once per content key, the first take
        # of a shot builds it under a lock, the others link it)
        import fcntl, hashlib
        t = time.time()
        hk = hashlib.sha1(open(root, 'rb').read())
        for x in layers + [os.path.abspath(a.template), os.path.join(EXPORT, 'ue_prep.py')]:
            st_ = os.stat(x); hk.update(f'{x}|{st_.st_size}|{int(st_.st_mtime)}'.encode())
        cache = os.path.join(os.environ.get('UE_ACTPREP_CACHE', '/data0/projectnyc_aux/ue_cache/actprep'), f'{a.shot}_{hk.hexdigest()[:16]}')
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        lk = open(cache + '.lock', 'w'); fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            code = 0
            if not os.path.exists(os.path.join(cache, 'DONE')):
                shutil.rmtree(cache, ignore_errors=True)
                code = subprocess.call(['uv', 'run', '--no-project', '--with', 'usd-core', '--with', 'numpy', '--with', 'pillow', '--with', 'scipy', 'python',
                                        os.path.join(EXPORT, 'ue_prep.py'), '--usd', root, '--out', cache], stdout=open(os.path.join(out, 'prep.log'), 'w'), stderr=subprocess.STDOUT)
                if code == 0: open(os.path.join(cache, 'DONE'), 'w').write(time.ctime())
                rec['prep_cache'] = 'built'
            else:
                rec['prep_cache'] = 'hit'
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN); lk.close()
        if os.path.islink(prep) or os.path.isfile(prep): os.remove(prep)
        elif os.path.isdir(prep): shutil.rmtree(prep)
        if code == 0: os.symlink(cache, prep)
        rec['prep_s'] = round(time.time() - t, 1); rec['prep_exit'] = code
        if code != 0: json.dump(rec, open(os.path.join(out, 'actors.json'), 'w'), indent=1); sys.exit('prep failed')
    side = os.path.join(prep, f'ue_{a.shot}.json')
    C = {'shot': a.shot, 'world_level': a.world_level, 'side': side, 'run': a.run, 'out': os.path.join(out, 'raw'),
         'frames': [int(x) for x in a.frames.split('-')] if a.frames else None, 'result': os.path.join(out, 'act_import.json'),
         'peds': any('peds' in os.path.basename(x) for x in layers), 'tag': a.tag,
         'new_level_with': a.new_level_with.split(',') if a.new_level_with else None, 'light_harvest': a.light_harvest,
         'cell_tables': os.path.abspath(a.cell_tables) if a.cell_tables else None}
    os.makedirs(C['out'], exist_ok=True)
    cp = os.path.join(out, 'act_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_ACT_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    if os.path.exists('/usr/share/vulkan/icd.d/nvidia_icd.json'): env.setdefault('VK_ICD_FILENAMES', '/usr/share/vulkan/icd.d/nvidia_icd.json')
    if first <= 2:
        t = time.time()
        with open(os.path.join(out, 'act_import.log'), 'w') as lf:
            code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                    f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                                   stdout=lf, stderr=subprocess.STDOUT, env=env)
        rec['import_process_s'] = round(time.time() - t, 1); rec['import_exit'] = code
        try: rec['import'] = json.load(open(C['result']))
        except Exception: json.dump(rec, open(os.path.join(out, 'actors.json'), 'w'), indent=1); sys.exit('import failed')
    if a.norender: json.dump(rec, open(os.path.join(out, 'actors.json'), 'w'), indent=1); print(json.dumps(rec)[:2000]); return
    rel = json.load(open(C['result']))['mrq']['manifest']
    W, H = a.res.split('x')
    env2 = dict(env); env2.pop('R1C_ACT_CFG', None); env2['DRI_PRIME'] = f'pci-0000_{a.gpu_pci}_00_0'
    import fcntl
    shutil.rmtree(C['out'], ignore_errors=True); os.makedirs(C['out'], exist_ok=True)
    gl = open(os.path.join('/data0/projectnyc_aux/tmp/ue_gpu_locks', f"pci-0000_{a.gpu_pci}_00_0.lock"), 'a+')
    tw = time.time(); fcntl.flock(gl, fcntl.LOCK_EX); rec['gpu_wait_s'] = round(time.time() - tw, 1)
    gl.seek(0); gl.truncate(); gl.write(f'pid {os.getpid()} {time.ctime()} r1c actors'); gl.flush()
    t1 = time.time()
    with open(os.path.join(out, 'render.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor'), PROJECT, 'MoviePipelineEntryMap', '-game',
                                f'-MoviePipelineConfig={rel}', '-RenderOffscreen', '-Unattended', '-NoSplash', '-NoLoadingScreen', '-nosound', '-windowed',
                                f'-resx={W}', f'-resy={H}', '-graphicsadapter=0', '-log', '-stdout', '-FullStdOutLogOutput', '-NoTextureStreaming'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env2)
    rec['render_s'] = round(time.time() - t1, 1); rec['render_exit'] = code
    fs = sorted(f for f in os.listdir(C['out']) if f.endswith('_FinalImage.png'))
    ts = [os.path.getmtime(os.path.join(C['out'], f)) for f in fs]
    if ts:
        dts = sorted(b - a_ for a_, b in zip(ts, ts[1:]))
        rec.update(frames=len(ts), first_frame_s=round(ts[0] - t1, 1), mean_frame_s=round((ts[-1] - ts[0]) / max(len(ts) - 1, 1), 3),
                   median_frame_s=round(dts[len(dts) // 2], 3) if dts else None)
    json.dump(rec, open(os.path.join(out, 'actors.json'), 'w'), indent=1)
    print(json.dumps({k: v for k, v in rec.items() if k != 'import'}, indent=1))


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
