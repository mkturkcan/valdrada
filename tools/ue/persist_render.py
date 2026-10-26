#!/usr/bin/env python3
# A shot rendered in the persistent city level (docs/notes/ue-persistent-city.md): no world or take is assembled; the
# Movie Render Queue opens /Game/City/L_City and plays /Game/City/Shots/LS_<shot>, World Partition streaming the blocks
# round the lens. The shot's sequence is made once from its latest take (--convert, or when it is missing): its lens and
# light rig as spawnables (tools/ue/persist_shot_editor.py).
#   python3 tools/ue/persist_render.py <shot> [--frames a-b] [--preset cine2h] [--gpu-pci 41] [--convert] [--out <dir>] [--server <dir>]
#   python3 tools/ue/persist_render.py serve --server <dir> [--gpu-pci 41]   (the shot server: a game process holding
#     L_City and the GPU; each `<shot> --server <dir>` is then rendered in it without starting an engine)
# Writes <out>/raw/frame_*.png and <out>/persist_ue.json (first_frame_s from the render's start, peak_vram_mib, ...).
import argparse, fcntl, glob, json, os, shutil, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_take as RT

MAP = '/Game/City/L_City'
SHOTS = '/Game/City/Shots'
PDIR = os.path.join(RT.UECACHE, 'persist')


def latest_take(shot):
    best = None
    for tj in glob.glob(os.path.join(RT.UECACHE, 'takes', '*', 'take.json')):
        try: T = json.load(open(tj))
        except Exception: continue
        if T.get('status') == 'ok' and str(T.get('level', '')).startswith(f'/Game/T/{shot}_') and os.path.exists(T.get('manifest', '')):
            m = os.path.getmtime(tj)
            if not best or m > best[0]: best = (m, os.path.dirname(tj), T)
    return best


def convert(shot, tdir, T, logf):
    imp = json.load(open(os.path.join(tdir, 'act', 'act_import.json')))
    man = json.load(open(T['manifest']))
    seq = None
    def walk(o):
        nonlocal seq
        if isinstance(o, dict):
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o:
                if isinstance(v, str) and v.startswith('Object:') and '/LS_' in v: seq = v[len('Object:'):].split('.')[0]
                walk(v)
    walk(man)
    job = os.path.join(PDIR, 'shots', f'{shot}.job.json'); res = os.path.join(PDIR, 'shots', f'{shot}.result.json')
    os.makedirs(os.path.dirname(job), exist_ok=True)
    json.dump({'act_level': imp['sublevel'], 'sequence': seq, 'dest': f'{SHOTS}/LS_{shot}', 'result': res}, open(job, 'w'))
    env = RT.ue_env(); env['PERSIST_SHOT'] = job
    t = time.time()
    code = subprocess.call([os.path.join(RT.UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), RT.PROJECT, '-run=pythonscript',
                            f'-script={os.path.join(HERE, "persist_shot_editor.py")}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                           stdout=open(logf, 'w'), stderr=subprocess.STDOUT, env=env)
    R = json.load(open(res)) if os.path.exists(res) else {'ok': False}
    R.update(take=os.path.basename(tdir), source_sequence=seq, exit=code, convert_s=round(time.time() - t, 1))
    json.dump(R, open(os.path.join(PDIR, 'shots', f'{shot}.json'), 'w'), indent=1)
    return R


def vram_sampler(pci, stop, out):
    while not stop.is_set():
        try:
            v = subprocess.run(['nvidia-smi', f'--id=00000000:{pci}:00.0', '--query-gpu=memory.used', '--format=csv,noheader,nounits'],
                               capture_output=True, text=True, timeout=10).stdout.strip()
            out.append((time.time(), int(v.split()[0])))
        except Exception: pass
        stop.wait(1.0)


def engine_env(pci):
    env = RT.ue_env(); env['DRI_PRIME'] = f'pci-0000_{pci}_00_0'
    # (the driver's compiled pipelines kept between runs: the default 1 GB cache in ~/.cache/nvidia sat full at 966 MB and
    # every render compiled its pipelines again, part of the minutes before the first frame; a larger cache on /data0)
    env.setdefault('__GL_SHADER_DISK_CACHE_PATH', '/data0/projectnyc_aux/ue/nvcache'); env.setdefault('__GL_SHADER_DISK_CACHE_SIZE', str(16 * 1024 ** 3))
    env.setdefault('__GL_SHADER_DISK_CACHE_SKIP_CLEANUP', '1'); os.makedirs(env['__GL_SHADER_DISK_CACHE_PATH'], exist_ok=True)
    return env


def serve(a):
    """the shot server: L_City loaded in a game process on the GPU (its lock held while it runs), rendering requests"""
    d = os.path.abspath(a.server); os.makedirs(d, exist_ok=True)
    settings = os.path.join(HERE, f'render_take_{a.preset}.json')
    cv = json.load(open(settings)).get('cvars') or {}
    W_, H_ = json.load(open(settings)).get('res', '2560x1440').split('x')
    gl = open(os.path.join('/data0/projectnyc_aux/tmp/ue_gpu_locks', f'pci-0000_{a.gpu_pci}_00_0.lock'), 'a+')
    fcntl.flock(gl, fcntl.LOCK_EX); gl.seek(0); gl.truncate(); gl.write(f'pid {os.getpid()} {time.ctime()} persist shot server'); gl.flush()
    pool = cv.get('r.Nanite.Streaming.StreamingPoolSize', 1024)
    for f in os.listdir(d):
        if f.endswith(('.running', '.req')): os.remove(os.path.join(d, f))
    # (the game's own viewport at 320x180: it renders beside the queue's view every frame, and at the queue's size its
    # second set of targets and Lumen caches ran the 48 GB card out of memory in the first shot's warm-up)
    exe = [COOKED, MAP] if a.cooked else [os.path.join(RT.UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor'), RT.PROJECT, MAP, '-game']
    code, secs = RT.run([*exe,
                         '-RenderOffscreen', '-Unattended', '-NoSplash', '-NoLoadingScreen', '-nosound', '-windowed', '-resx=320', '-resy=180', '-graphicsadapter=0',
                         '-log', '-stdout', '-FullStdOutLogOutput', f'-dpcvars=r.Nanite.Streaming.StreamingPoolSize={pool},r.Streaming.PoolSize=6000,valdrada.BlockStreaming=1,valdrada.ShotServerDir={d}',
                         *([f'-ExecCmds={a.exec}'] if a.exec else [])],
                        os.path.join(d, 'server.log'), env=engine_env(a.gpu_pci))
    print('server exit', code, secs)


def ballast(pci, cap, rdir):
    """a resident process holding all but <cap> MiB of the GPU (tools/ue/vram_ballast.py): the render sees only <cap>"""
    rf = os.path.join(rdir, 'ballast.ready')
    p = subprocess.Popen([sys.executable, os.path.join(HERE, 'vram_ballast.py'), '--pci', pci, '--free', str(cap), '--ready', rf],
                         stdout=open(os.path.join(rdir, 'ballast.log'), 'w'), stderr=subprocess.STDOUT)
    for _ in range(120):
        if os.path.exists(rf) or p.poll() is not None: break
        time.sleep(1)
    if not os.path.exists(rf): p.kill(); sys.exit('ballast failed')
    return p, int(open(rf).read().split()[1])


COOKED = os.path.join(PDIR, 'cooked', 'stage', 'Linux', 'BoundlessUE', 'Binaries', 'Linux', 'BoundlessUE')


def cooked(a):
    """the shot from the cooked build: cooked packages from paks, no derived-data cache; frames to
    ue_cache/persist/cooked_out/LS_<shot> (the settings asset's output folder)"""
    t0 = time.time()
    rdir = a.out or os.path.join(PDIR, 'runs', f'{a.shot}_cooked_{time.strftime("%Y%m%d-%H%M%S")}'); os.makedirs(rdir, exist_ok=True)
    sfx = f'_{a.tier}' if a.tier else ''
    T_ = json.load(open(os.path.join(HERE, 'persist_tiers.json'))).get(a.tier, {}) if a.tier else {}
    pc_ = json.load(open(os.path.join(HERE, f'render_take_{a.preset}.json'))).get('cvars') or {}
    # (pools sized at start, as the queue will set them: a pool the queue resizes at its first frame tripped an
    # assertion in Nanite's streaming copy, 'SrcOffset + NumBytes <= SourceBuffer->GetSize()')
    pool, tex = int(T_.get('r.Nanite.Streaming.StreamingPoolSize', pc_.get('r.Nanite.Streaming.StreamingPoolSize', 1024))), int(T_.get('r.Streaming.PoolSize', 3000))
    outd = os.path.join(PDIR, 'cooked_out', a.tier or 'default', f'LS_{a.shot}'); shutil.rmtree(outd, ignore_errors=True)
    gl = open(os.path.join('/data0/projectnyc_aux/tmp/ue_gpu_locks', f'pci-0000_{a.gpu_pci}_00_0.lock'), 'a+')
    fcntl.flock(gl, fcntl.LOCK_EX)
    bal, held = ballast(a.gpu_pci, a.vram_cap, rdir) if a.vram_cap else (None, 0)
    stop, vr = threading.Event(), []
    th = threading.Thread(target=vram_sampler, args=(a.gpu_pci, stop, vr), daemon=True); th.start()
    base = 0
    if bal:   # (what the card held besides the ballast before the render: its CUDA context and the desktop)
        base = int(subprocess.run(['nvidia-smi', f'--id=00000000:{a.gpu_pci}:00.0', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], capture_output=True, text=True).stdout.split()[0]) - held
    t1 = time.time()
    code, secs = RT.run([COOKED, '/MovieRenderPipeline/MoviePipelineEntryMap', f'-MoviePipelineConfig=/Game/City/MRQ/Q_{a.shot}{sfx}',
                         '-RenderOffscreen', '-Unattended', '-NoSplash', '-NoLoadingScreen', '-nosound', '-windowed', '-resx=2560', '-resy=1440', '-graphicsadapter=0',
                         '-log', '-stdout', '-FullStdOutLogOutput', f'-dpcvars=r.Nanite.Streaming.StreamingPoolSize={pool},r.Streaming.PoolSize={tex}' + ''.join(f',{k}={v}' for k, v in T_.items() if k not in ('r.Nanite.Streaming.StreamingPoolSize', 'r.Streaming.PoolSize', 'res')) + (f',valdrada.DumpAfter={a.dump_after}' if a.dump_after else '') + (f',r.Vulkan.FakeMemoryLimit={a.vram_limit}' if a.vram_limit else '') + ''.join(f',{kv}' for kv in a.cvar)], os.path.join(rdir, 'render.log'), env=engine_env(a.gpu_pci))
    stop.set(); th.join(5)
    if bal: bal.kill(); bal.wait()
    fcntl.flock(gl, fcntl.LOCK_UN)
    fs = sorted(glob.glob(os.path.join(outd, '**', '*_FinalImage.png'), recursive=True))
    ts = sorted(os.path.getmtime(f) for f in fs)
    rec = {'shot': a.shot, 'cooked': True, 'tier': a.tier or 'default', 'vram_limit_mb': a.vram_limit, 'exit': code, 'render_s': secs, 'frames': len(fs), 'first_frame_s': round(ts[0] - t1, 1) if ts else None,
           'mean_frame_s': round((ts[-1] - ts[0]) / max(len(ts) - 1, 1), 3) if len(ts) > 1 else None, 'peak_vram_mib': max((v for _, v in vr), default=None),
           'vram_cap_mib': a.vram_cap, 'ballast_mib': held, 'peak_vram_game_mib': (max((v for _, v in vr), default=0) - held - base) if a.vram_cap else None,
           'oom': bool(subprocess.run(['grep', '-qiE', 'OUT_OF_DEVICE_MEMORY|Out of video memory|OutOfMemory|Failed to allocate Device Memory', os.path.join(rdir, 'render.log')]).returncode == 0),
           'out': outd, 'total_s': round(time.time() - t0, 1)}
    json.dump({'samples': vr}, open(os.path.join(rdir, 'vram.json'), 'w'))
    if a.clips and fs:   # (the trailer's clip layout, as render_take.py writes it: <root>/all/clips/<shot>/frame_%05d.jpg)
        lt = latest_take(a.shot); T = lt[2] if lt else {}
        outdir = os.path.join(a.clips, 'all', 'clips', a.shot)
        if os.path.isdir(outdir) and any(f.startswith('frame_') for f in os.listdir(outdir)):
            os.rename(outdir, f'{outdir}.prev-{time.strftime("%Y%m%d-%H%M%S")}')
        os.makedirs(outdir, exist_ok=True)
        c_, rec['frames_s'] = RT.run(RT.uvpy('numpy', 'pillow', 'OpenEXR') + [os.path.join(RT.EXPORT, 'ue_frames.py'), '--raw', outd, '--out', outdir, '--side', T.get('side', ''),
                                    '--res', '2560x1440', '--quality', '95', '--t0', str(t1), '--json', os.path.join(rdir, 'frames.json')], os.path.join(rdir, 'frames.log'))
        rec['clip'] = outdir; rec['clip_frames'] = len([f for f in os.listdir(outdir) if f.startswith('frame_') and f.endswith('.jpg')])
        json.dump(rec, open(os.path.join(outdir, 'take_ue.json'), 'w'), indent=1)
    json.dump(rec, open(os.path.join(rdir, 'persist_ue.json'), 'w'), indent=1); print(json.dumps(rec))
    # (a shot whose frames are all written counts as rendered: the cooked game sometimes hangs a minute in its shutdown
    # after the queue's last frame, 'GameThread timed out waiting for RenderThread', and exits on signal 11)
    done_ = subprocess.run(['grep', '-q', 'Finished rendering last shot', os.path.join(rdir, 'render.log')]).returncode == 0
    rec['finished'] = done_; json.dump(rec, open(os.path.join(rdir, 'persist_ue.json'), 'w'), indent=1)
    sys.exit(0 if fs and (code == 0 or done_) and (not a.clips or rec.get('clip_frames')) else 5)


def main():
    import resource; resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    ap = argparse.ArgumentParser()
    ap.add_argument('shot'); ap.add_argument('--frames', default=None); ap.add_argument('--preset', default='cine2h')
    ap.add_argument('--gpu-pci', default='41'); ap.add_argument('--convert', action='store_true'); ap.add_argument('--out', default=None)
    ap.add_argument('--texture-streaming', type=int, default=1, help='0: -NoTextureStreaming as the takes')
    ap.add_argument('--exec', default='', help='serve: console commands once the level is up, e.g. "wp.Runtime.OverrideRuntimeLoadingRange -grid=Far -range=1500000"')
    ap.add_argument('--prepare', action='store_true', help='save the shot\'s settings and queue assets (PC_/Q_) and stop')
    ap.add_argument('--cooked-server', action='store_true', help='with --server: the server is the cooked build (requests name the queue asset)')
    ap.add_argument('--cooked', action='store_true', help='render from the cooked build (tools/ue/persist_cook.sh) with the shot\'s saved settings /Game/City/MRQ/PC_<shot>')
    ap.add_argument('--blocks-m', type=float, default=0, help='the blocks\' loading range for this render, m (0: the level\'s 4 km)')
    ap.add_argument('--vram-limit', type=int, default=0, help='MB: cooked runs see only this much video memory (r.Vulkan.FakeMemoryLimit), to prove a tier fits')
    ap.add_argument('--clips', default=None, help='cooked: also write the trailer clip <clips>/all/clips/<shot>/frame_%%05d.jpg (render_take.py\'s layout)')
    ap.add_argument('--vram-cap', type=int, default=0, help='MiB: a resident ballast process holds the rest of the card (tools/ue/vram_ballast.py), so the render sees only this much')
    ap.add_argument('--tier', default='', choices=('', 'low', 'medium', 'high', 'cinematic'), help='graphics tier (tools/ue/persist_tiers.json)')
    ap.add_argument('--cvar', action='append', default=[], help='k=v: a job cvar over the preset\'s (repeatable)')
    ap.add_argument('--rt-m', type=float, default=0, help='blocks beyond this many metres leave the ray tracing scene (0: none)')
    ap.add_argument('--kit', type=int, default=1, help='0: no kit instances (memory attribution)')
    ap.add_argument('--dump-after', type=float, default=0, help='seconds: memory reports in the log (valdrada.DumpAfter)')
    ap.add_argument('--texture-pool', type=int, default=3000, help='MB of streamed textures')
    ap.add_argument('--server', default=None, help='a shot server\'s request folder (serve, or a render sent to it)')
    a = ap.parse_args()
    if a.shot == 'serve': return serve(a)
    if a.cooked and not a.server: return cooked(a)
    t0 = time.time()
    rdir = a.out or os.path.join(PDIR, 'runs', f'{a.shot}_{time.strftime("%Y%m%d-%H%M%S")}')
    os.makedirs(rdir, exist_ok=True)
    rec = {'shot': a.shot, 'started': time.ctime(), 'map': MAP, 'preset': a.preset, 'gpu_pci': a.gpu_pci}
    lt = latest_take(a.shot)
    if not lt: print('no take of', a.shot); sys.exit(2)
    _, tdir, T = lt
    sj = os.path.join(PDIR, 'shots', f'{a.shot}.json')
    S = json.load(open(sj)) if os.path.exists(sj) else None
    if a.convert or not S or not S.get('ok'):
        S = convert(a.shot, tdir, T, os.path.join(rdir, 'convert.log'))
        rec['convert_s'] = S.get('convert_s')
        if not S.get('ok'): print('conversion failed', S.get('errors')); json.dump(rec, open(os.path.join(rdir, 'persist_ue.json'), 'w'), indent=1); sys.exit(4)
    rec['sequence'] = f'{SHOTS}/LS_{a.shot}'; rec['take_source'] = S.get('take')
    # the manifest: the take's (its job settings), opened on the city level with the shot's sequence
    settings = os.path.join(HERE, f'render_take_{a.preset}.json')
    cv = dict(json.load(open(settings)).get('cvars') or {}); cv['valdrada.BlockStreaming'] = 1
    # (a 16 GB budget: the texture pool capped and held to the card; the Nanite streaming pool stays at the preset's)
    cv['r.Streaming.PoolSize'] = a.texture_pool; cv['r.Streaming.LimitPoolSizeToVRAM'] = 1
    if a.dump_after: cv['valdrada.DumpAfter'] = a.dump_after   # (job cvars: applied once the level is up; a plugin's cvars miss -dpcvars)
    if not a.kit: cv['valdrada.Kit'] = 0
    if a.blocks_m: cv['valdrada.BlocksRangeM'] = a.blocks_m
    if a.rt_m: cv['valdrada.RTRangeM'] = a.rt_m
    if a.tier:   # (a graphics tier over the preset: tools/ue/persist_tiers.json)
        for k_, v_ in json.load(open(os.path.join(HERE, 'persist_tiers.json')))[a.tier].items():
            if k_ != 'res': cv[k_] = float(v_)
    for kv in a.cvar: k_, v_ = kv.split('=', 1); cv[k_] = float(v_)
    side = json.load(open(T['side'])) if os.path.exists(T.get('side', '')) else {}
    lo, hi = (side.get('frames') or [0, 150])
    fa, fb = (map(int, a.frames.split('-')) if a.frames else (lo, hi))
    raw = os.path.join(rdir, 'raw'); os.makedirs(raw, exist_ok=True)
    txt = open(T['manifest']).read()
    J = json.loads(txt)
    def walk(o):
        if isinstance(o, dict):
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                if isinstance(v, str) and v.startswith('Object:/Game/T/'): o[i] = f'Object:{MAP}'
                elif isinstance(v, str) and v.startswith('Object:') and '/LS_' in v: o[i] = f'Object:{SHOTS}/LS_{a.shot}.LS_{a.shot}'
                else: walk(v)
    walk(J)
    res_ = json.load(open(os.path.join(HERE, 'persist_tiers.json'))).get(a.tier, {}).get('res') if a.tier else None
    if res_:   # (a tier's output resolution: the queue's OutputResolution, an int pair in base64)
        import base64, struct
        w_, h_ = map(int, res_.split('x'))
        def wres(o):
            if isinstance(o, dict):
                if isinstance(o.get('OutputResolution'), dict): o['OutputResolution']['__Value']['Data'] = 'Base64:' + base64.b64encode(struct.pack('<ii', w_, h_)).decode()
                for v in o.values(): wres(v)
            elif isinstance(o, list):
                for v in o: wres(v)
        wres(J)
    src = os.path.join(rdir, 'manifest_src.utxt'); json.dump(J, open(src, 'w'), indent='\t')
    rel = f'MovieRenderPipeline/pc_{a.shot}_{os.path.basename(rdir)}.utxt'
    if not RT.patch_manifest(src, os.path.join(RT.SAVED, rel), raw, fa, fb - 1, cv): print('manifest has no output'); sys.exit(5)
    if a.prepare:   # (the shot's settings and queue as assets for the cooked build and the server: /Game/City/MRQ/PC_ and Q_)
        jp = os.path.join(rdir, 'mrq_job.json')
        sfx = f'_{a.tier}' if a.tier else ''
        json.dump({'shots': [{'manifest': os.path.join(RT.SAVED, rel), 'dest': f'/Game/City/MRQ/PC_{a.shot}{sfx}',
                              'out': os.path.join(PDIR, 'cooked_out', a.tier or 'default', '{sequence_name}')}], 'result': os.path.join(rdir, 'mrq_result.json')}, open(jp, 'w'))
        env = RT.ue_env(); env['PERSIST_MRQ'] = jp
        code = subprocess.call([os.path.join(RT.UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), RT.PROJECT, '-run=pythonscript',
                                f'-script={os.path.join(HERE, "persist_mrq_editor.py")}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=open(os.path.join(rdir, 'mrq.log'), 'w'), stderr=subprocess.STDOUT, env=env)
        R = json.load(open(os.path.join(rdir, 'mrq_result.json'))) if os.path.exists(os.path.join(rdir, 'mrq_result.json')) else {}
        print(json.dumps(R)); sys.exit(0 if R.get('saved') else 4)
    if a.server:   # (rendered by the running shot server: no engine start, no map load)
        name = f'{a.shot}_{os.path.basename(rdir)}'; d = os.path.abspath(a.server)
        stop, vr = threading.Event(), []
        th = threading.Thread(target=vram_sampler, args=(a.gpu_pci, stop, vr), daemon=True); th.start()
        t1 = time.time()
        req = (f'queue=/Game/City/MRQ/Q_{a.shot}\nout={raw}\n' if a.cooked_server else f'manifest={os.path.join(RT.SAVED, rel)}\n')
        open(os.path.join(d, name + '.tmp'), 'w').write(req); os.replace(os.path.join(d, name + '.tmp'), os.path.join(d, name + '.req'))
        done = os.path.join(d, name + '.done')
        while not os.path.exists(done) and time.time() - t1 < 7200: time.sleep(1)
        stop.set(); th.join(5)
        fs = sorted(f for f in os.listdir(raw) if f.endswith('_FinalImage.png'))
        ts = [os.path.getmtime(os.path.join(raw, f)) for f in fs]
        rec.update(server=d, result=open(done).read().strip() if os.path.exists(done) else 'timeout', frames=len(fs), frames_wanted=fb - fa,
                   first_frame_s=round(ts[0] - t1, 1) if ts else None, mean_frame_s=round((ts[-1] - ts[0]) / max(len(ts) - 1, 1), 3) if len(ts) > 1 else None,
                   peak_vram_mib=max((v for _, v in vr), default=None), total_s=round(time.time() - t0, 1))
        json.dump(rec, open(os.path.join(rdir, 'persist_ue.json'), 'w'), indent=1); print(json.dumps(rec))
        sys.exit(0 if len(fs) >= fb - fa else 5)
    env = engine_env(a.gpu_pci)
    W_, H_ = json.load(open(settings)).get('res', '2560x1440').split('x')
    gl = open(os.path.join('/data0/projectnyc_aux/tmp/ue_gpu_locks', f'pci-0000_{a.gpu_pci}_00_0.lock'), 'a+')
    tw = time.time(); fcntl.flock(gl, fcntl.LOCK_EX); rec['gpu_wait_s'] = round(time.time() - tw, 1)
    gl.seek(0); gl.truncate(); gl.write(f'pid {os.getpid()} {time.ctime()} persist_render {a.shot}'); gl.flush()
    startup = [f'-dpcvars=r.Nanite.Streaming.StreamingPoolSize={cv["r.Nanite.Streaming.StreamingPoolSize"]},valdrada.BlockStreaming=1'] if 'r.Nanite.Streaming.StreamingPoolSize' in cv else ['-dpcvars=valdrada.BlockStreaming=1']
    stop, vr = threading.Event(), []
    th = threading.Thread(target=vram_sampler, args=(a.gpu_pci, stop, vr), daemon=True); th.start()
    t1 = time.time()
    code, secs = RT.run([os.path.join(RT.UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor'), RT.PROJECT, 'MoviePipelineEntryMap', '-game', f'-MoviePipelineConfig={rel}',
                         '-RenderOffscreen', '-Unattended', '-NoSplash', '-NoLoadingScreen', '-nosound', '-windowed', f'-resx={W_}', f'-resy={H_}', '-graphicsadapter=0',
                         '-log', '-stdout', '-FullStdOutLogOutput', *([] if a.texture_streaming else ['-NoTextureStreaming']), *startup], os.path.join(rdir, 'render.log'), env=env)
    stop.set(); th.join(5)
    fcntl.flock(gl, fcntl.LOCK_UN); gl.close()
    fs = sorted(f for f in os.listdir(raw) if f.endswith('_FinalImage.png'))
    ts = [os.path.getmtime(os.path.join(raw, f)) for f in fs]
    rec.update(exit=code, render_s=secs, frames=len(fs), frames_wanted=fb - fa,
               first_frame_s=round(ts[0] - t1, 1) if ts else None, first_frame_from_start_s=round(ts[0] - t0, 1) if ts else None,
               mean_frame_s=round((ts[-1] - ts[0]) / max(len(ts) - 1, 1), 3) if len(ts) > 1 else None,
               peak_vram_mib=max((v for _, v in vr), default=None), vram_samples=len(vr), total_s=round(time.time() - t0, 1))
    json.dump({'samples': vr}, open(os.path.join(rdir, 'vram.json'), 'w'))
    json.dump(rec, open(os.path.join(rdir, 'persist_ue.json'), 'w'), indent=1)
    print(json.dumps(rec))
    sys.exit(0 if code == 0 and len(fs) >= fb - fa else 5)


if __name__ == '__main__':
    main()
