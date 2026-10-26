# UE (AR34, 2026-10-06): time of day, the street and vehicle lamps, exposure and the film look for a UE take, the
# counterpart of blender_light.py. Runs inside the engine from ue_take.py after the import and ue_mat.py; reads the take's
# data (ue_<shot>.json from ue_prep.py) and the harvest's light pass (light_static.json, sky_vis.hdr / sky_env.hdr).
#   SUN     the page's key light (sunDir, sunColor, sunIntensity x SUN_K) as a directional light; none when the sun is
#           under the horizon (night)
#   SKY     the captured domes: sky_env.hdr (or sky_vis at golden, as blender_light's --skysrc vis) as the sky light's cubemap
#           x envIntensity x SKY_K, sky_vis.hdr on an unlit sky sphere (the camera's sky)
#   LAMPS   every street lamp of the light pass within LAMP_CULL m of the lens path as a point light at its lens, pointing
#           down, with the cobrahead / Bishop's Crook throw (blender_light.throw_profile) as an IES profile, the fixture's
#           candela x the rig's gain x night x TL31's dim, its colour and range; shadowed by MegaLights
#   VEHICLES the cars whose lamp mask has the headlamps on: two spot lights per car at its lamp anchors (role 1), attached
#           to the car's actor, so they follow it through the take (night and dusk)
#   FILM    an unbound post-process volume: manual exposure (EV per time of day, measured against the web take: EV_BIAS,
#           --ev overrides), the web grade's saturation and contrast, bloom, vignette, the motion blur (--mblur: the web's
#           half-frame streak), Lumen's quality
import json, math, os, time
import unreal

eal = unreal.EditorAssetLibrary
els = unreal.EditorLevelLibrary
SUN_K = 1.0
SKY_K = 1.0
# R7-SKY (UE track, 2026-10-08): the night dome lights UE's walls far less than Cycles' (the same visible dome at sky_k 1
# in both): t8VictoriaCrane f054, a blank party wall facing the open sky reads black in UE and grey in Cycles; buildings L*
# 11.0 / 15.2 / 18.0 at x 1 / 4 / 6 against Cycles' 24.6, and the web check's off-lightness 10.1 / 1.9 / 2.8 % (limit 2);
# the lamps' Lumen bounce (1.0 against 0.65) and MegaLights off moved nothing. UE's share of the dome at night, physical
# light only (golden and dusk as before)
SKY_UE = {'night': 4.0}
# and Lumen's sky light leaking at night, so the walls in the street canyons get the dome's light the roofs already have
# (t8MuseumGlide buildings L* 19.4 / 21.7 / 23.6 at 0 / 0.15 / 0.3 against Cycles' 30.0; t8VictoriaCrane 15.2 / 18.3 /
# 21.2 against 24.6); BXUE_LEAK: a test aid
SKY_LEAK = {'night': 0.3}
GI_PP = {}   # UE13: the post-process indirect lighting scale per time of day (physical light; see film())
SKY_SRC = {'golden': 'vis', 'day': 'vis'}   # the sky light's dome: 'vis' the visible dome x1 (the sky the camera sees, so glass and wet stone reflect it), else the IBL dome
SKY_VIS_LIGHT = {'golden': 1.0, 'day': 1.0}   # the visible dome as the sky light, x this
LAMP_K = 1.0   # the street lamps' candela x the rig's gain x night x TL31's dim, x this
# R4-NIGHT: the street lamps' (and headlamps') share in Lumen's bounce. Measured against the path tracer on t7DinoGlide f000 /
# f054: the viaduct L* 9.9 lit directly (GI off), 21.9 in Cycles physical, 30.1 in UE with GI at 1: Lumen's bounce of the
# many lamps (its surface cache) comes out 2.2x the path tracer's; 0.45 brings it to Cycles' (golden's sun bounce matches
# at 1). R5-VEG: 0.65, the night crowns away from the lamps live on that bounce (frames 18-36 of t7DinoGlide went grey
# and dark at 0.45: vegetation L* 11-18 against 19-26); the viaduct at 0.45 read 22.9 against 24.2
LAMP_GI = 0.65
AMB_K = {'golden': 0.5, 'day': 0.5, 'dusk': 1.0, 'night': 1.0}   # the web's ambient rig (hemisphere lights + IBL dome, unoccluded); golden x0.5 beside the visible dome
SUN_GI = {'golden': 0.0, 'day': 0.0}   # the sun's share in Lumen's bounce: none, as the web (its warm bounce turned the shade olive at the page's exposure)
SKY_VIS_K = {}   # the visible dome on the sky sphere, x1
FILL_K = {'golden': 0.0, 'day': 0.0, 'dusk': 0.0, 'night': 0.0}   # superseded by the ambient rig (AMB_K)
SKY_ENV_K = {'golden': 0.25, 'day': 0.25, 'dusk': 0.25, 'night': 0.25}   # UE's sky light (the IBL dome, occluded by Lumen) beside the unoccluded rig
EV_BIAS = {'golden': 0.0, 'day': 0.0, 'dusk': 0.0, 'night': 0.0}   # on the page's exposure (AgX in M_bx_film)
LAMP_CULL = 250.0          # m from the lens path
# R3-PHYS (2026-10-07, owner: physical light for Cycles and Unreal): --light phys (default) | web (ue_take.py). phys: the
# sun's bounce in Lumen at 1, no ambient fills, the visible dome as the only sky light at phys_light.json sky_k (Lumen GI
# with hardware ray tracing), the exposure fixed per time of day from phys_light.json, which blender_light.py reads too, so
# the Cycles and Unreal takes are lit alike; web: the tables above, matched to the web takes (the gate baselines).
PHYS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phys_light.json')


def phys(cfg):
    """the physical light table, or None for the web-matched rig (--light web)."""
    if str((cfg or {}).get('light') or 'phys') == 'web': return None
    try: return _j(PHYS_JSON) or {}
    except Exception: return {}
# R3-PHYS end


def ue_pos(side, p):
    """the web's world (metres, y up) -> UE (cm, z up), through the take's recentring."""
    og = side['data'].get('origin') or [0, 0, 0]
    x, y, z = float(p[0]) - float(og[0]), float(p[1]) - float(og[1]), float(p[2]) - float(og[2])
    return unreal.Vector(x * 100.0, z * 100.0, y * 100.0)


def ue_dir(d):
    return unreal.Vector(float(d[0]), float(d[2]), float(d[1]))


MISS = []


def sp(obj, k, v):
    """obj.k = v through the reflection system; a property this engine version lacks is recorded (the light's
    option_misses in import.json), not fatal."""
    try:
        obj.set_editor_property(k, v); return True
    except Exception as e:
        MISS.append(f'{type(obj).__name__}.{k}: {e}'); unreal.log_warning(f'[bxue] ue_light: {type(obj).__name__}.{k}: {e}'); return False


def srgb8(c):
    """a linear colour (max 1) as the FColor a light takes (sRGB-encoded)."""
    m = max(1.0, max(float(v) for v in c))
    r, g, b = [int(max(0, min(255, round(255 * (float(v) / m) ** (1 / 2.2))))) for v in c[:3]]
    return unreal.Color(r=r, g=g, b=b, a=255)   # (keywords: the positional order of unreal.Color is b, g, r, a)


def _j(p):
    try: return json.load(open(p))
    except Exception: return None


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))) if e1 != e0 else (1.0 if x >= e1 else 0.0)
    return t * t * (3 - 2 * t)


def throw_profile(shape, cobra):
    """blender_light.throw_profile in pure Python: cityLamps.js cl24Throw, the arm along horizontal 90."""
    shift, width, floor = shape
    V = [float(v) for v in range(0, 91)] + [92.0, 95.0, 100.0, 180.0]
    Hs = list(range(0, 361, 5)) if cobra else [0]
    cd = []
    for h in Hs:
        row = []
        for v in V:
            vr, hr = math.radians(v), math.radians(h)
            sv = math.sin(vr)
            x, y, z = -sv * math.sin(hr), -sv * math.cos(hr), -math.cos(vr)
            c = -z
            hl = math.hypot(x, y)
            if cobra:
                wa = (-x) / hl if hl > 1e-4 else 0.0
                c0 = 0.60 + (0.36 - 0.60) * (1 - wa * wa) + shift
                t = max(0.0, min(1.0, wa / -0.85))
                back = 1.0 + (0.42 - 1.0) * t * t * (3 - 2 * t)
            else:
                c0 = 0.45 + shift; back = 1.0
            xx = (c - c0) / width
            f = smooth(0.0, 0.2, c) * (floor + (1 - floor) * math.exp(-xx * xx)) * back if c > 0 else 0.0
            row.append(100.0 * f)
        cd.append(row)
    return V, Hs, cd


def ies_text(V, Hs, cd, title):
    rows = ['IESNA:LM-63-2002', f'[TEST] {title}', '[MANUFAC] Valdrada (tabulated from the web shader)', 'TILT=NONE',
            f'1 -1 1 {len(V)} {len(Hs)} 1 2 0 0 0', '1 1 0']
    wrap = lambda vals: [' '.join(vals[i:i + 12]) for i in range(0, len(vals), 12)]
    rows += wrap([f'{v:g}' for v in V]) + wrap([f'{h:g}' for h in Hs])
    for i in range(len(Hs)): rows += wrap([f'{c:.3f}' for c in cd[i]])
    return '\n'.join(rows) + '\n'


def import_file(path, dest, name):
    task = unreal.AssetImportTask()
    sp(task, 'filename', path); sp(task, 'destination_path', dest)
    sp(task, 'destination_name', name); sp(task, 'automated', True)
    sp(task, 'replace_existing', True); sp(task, 'save', False)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    p = task.get_editor_property('imported_object_paths')
    return unreal.load_asset(p[0]) if p else None


def spawn(cls, loc=None, rot=None, label=None):
    a = els.spawn_actor_from_class(cls, loc or unreal.Vector(0, 0, 0), rot or unreal.Rotator(0, 0, 0))
    if label: a.set_actor_label(label)
    return a


def sky_material(dest, shot, cube):
    mel = unreal.MaterialEditingLibrary
    ap = f'{dest}/M_sky_{shot}'
    if eal.does_asset_exist(ap):   # built by an earlier run of this take (the same cubemap asset path)
        return eal.load_asset(ap)
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset(f'M_sky_{shot}', dest, unreal.Material, unreal.MaterialFactoryNew())
    sp(m, 'shading_model', unreal.MaterialShadingModel.MSM_UNLIT)
    sp(m, 'two_sided', True)
    try: sp(m, 'is_sky', True)
    except Exception: pass
    # the view ray V (UE world) looks up the cube at (V.y, -V.x, V.z): UE's long-lat import puts column 0.5 + atan2(D.x, -D.y)
    # / 2 pi and row acos(D.z) / pi on cube direction D, three's equirect puts the web's (V.x, V.z, V.y) at 0.5 +
    # atan2(z, x) / 2 pi and acos(y) / pi
    cv = mel.create_material_expression(m, unreal.MaterialExpressionCameraVectorWS, -900, 0)
    neg = mel.create_material_expression(m, unreal.MaterialExpressionCustom, -700, 0)
    sp(neg, 'code', 'float3 v = -Cam; return float3(v.y, -v.x, v.z);')
    sp(neg, 'output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    ci = unreal.CustomInput(); ci.set_editor_property('input_name', 'Cam'); sp(neg, 'inputs', [ci])
    mel.connect_material_expressions(cv, '', neg, 'Cam')
    ts = mel.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameterCube, -500, 0)
    sp(ts, 'parameter_name', 'Sky'); sp(ts, 'texture', cube)
    mel.connect_material_expressions(neg, '', ts, 'UVs')
    k = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -500, 250)
    sp(k, 'parameter_name', 'Intensity'); sp(k, 'default_value', 1.0)
    mul = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -250, 0)
    mel.connect_material_expressions(ts, 'RGB', mul, 'A'); mel.connect_material_expressions(k, '', mul, 'B')
    mel.connect_material_property(mul, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    return m


def cam_path(side):
    """the lens positions per frame (web metres) from the harvest's camera track."""
    h = side['data'].get('harvest') or ''
    c = _j(os.path.join(h, f"cam_{side['shot']}.json"))
    pts = []
    if isinstance(c, list):
        for r in c:
            p = r.get('pos') or r.get('p') or (r.get('m')[12:15] if isinstance(r.get('m'), list) and len(r['m']) == 16 else None) if isinstance(r, dict) else None
            if p: pts.append(p)
    return pts


def apply(side, dest, cfg, world):
    t0 = time.time()
    out = {}
    if cfg.get('nolights'): return {'skipped': True}
    data = side['data']
    shot = side['shot']
    h = data.get('harvest') or ''
    LS = _j(os.path.join(h, 'light_static.json')) or {}
    mode = LS.get('mode') or data.get('time') or 'golden'
    night = float(LS.get('night', 1.0 if mode == 'night' else 0.05) or 0)
    out['mode'] = mode; out['night'] = night
    PH = phys(cfg)   # R3-PHYS
    out['light'] = 'web' if PH is None else 'phys'
    # the importer's lights (lights.usda's sun and dome) and an earlier run's BX_ actors give way to these
    rm = 0
    for a in els.get_all_level_actors():
        if isinstance(a, (unreal.DirectionalLight, unreal.SkyLight)) or a.get_actor_label() in ('Sun', 'Sky') or a.get_actor_label().startswith('BX_'):
            els.destroy_actor(a); rm += 1
    out['importer_lights_removed'] = rm

    # ---- sun
    sd = data.get('sunDir') or [0, 1, 0]
    sun_vis = (LS.get('sun') or {}).get('visible', True) and float(sd[1]) > -0.02 and mode != 'night'
    if sun_vis:
        fwd = ue_dir([-float(v) for v in sd])
        rot = unreal.MathLibrary.make_rot_from_x(fwd)
        sun = spawn(unreal.DirectionalLight, unreal.Vector(0, 0, 10000), rot, 'BX_Sun')
        lc = sun.get_component_by_class(unreal.DirectionalLightComponent)
        col = data.get('sunColor') or [1, 1, 1]
        LJ = _j(os.path.join(h, 'lights.json')) or {}
        dirs = [float(L.get('intensity') or 0) for L in LJ.get('lights', []) if L.get('type') == 'DirectionalLight' and L.get('visible', True)]
        sp(lc, 'intensity', (sum(dirs) if dirs else float(data.get('sunIntensity') or 3.0)) * SUN_K)
        sp(lc, 'light_color', srgb8(col))
        sp(lc, 'use_temperature', False)
        sp(lc, 'light_source_angle', 0.53)
        sp(lc, 'cast_shadows', True)
        # Lumen's bounce of the low sun: the web has none, Cycles' is half UE's (t7ArchTrack 08:44: the shade under the
        # deck and on the road twice Cycles', yellow); SUN_GI per time of day
        sp(lc, 'indirect_lighting_intensity', float(SUN_GI.get(mode, 1.0)) if PH is None else float(os.environ.get('BXUE_SUNGI') or 1.0))   # R3-PHYS: the sun's bounce (BXUE_SUNGI: a test aid)
        try: sp(lc, 'atmosphere_sun_light', False)
        except Exception: pass
        out['sun'] = {'intensity': lc.get_editor_property('intensity'), 'rot': [rot.pitch, rot.yaw, rot.roll]}

    # ---- sky light and the sky sphere
    env = os.path.join(h, 'sky_env.hdr'); vis = os.path.join(h, 'sky_vis.hdr')
    cube_env = import_file(env, f'{dest}/Sky', 'T_sky_env') if os.path.exists(env) else None
    cube_vis = import_file(vis, f'{dest}/Sky', 'T_sky_vis') if os.path.exists(vis) else None
    sl = spawn(unreal.SkyLight, unreal.Vector(0, 0, 0), None, 'BX_SkyLight')
    slc = sl.get_component_by_class(unreal.SkyLightComponent)
    sp(slc, 'mobility', unreal.ComponentMobility.MOVABLE)
    # the diffuse light is the page's IBL dome (sky_env) x environmentIntensity x SKY_ENV_K at every time of day: the web's
    # golden shade is lit by that dome and its hemisphere lights, not by the visible sky (the visible dome as the light, as
    # blender_light's golden rig, put UE's shade at 2-4x the web's: t7ArchTrack 2026-10-07 07:59)
    cube = cube_vis if ((PH is not None or SKY_SRC.get(mode) == 'vis') and cube_vis) else (cube_env or cube_vis)   # R3-PHYS: the visible dome
    if cube is not None:
        sp(slc, 'source_type', unreal.SkyLightSourceType.SLS_SPECIFIED_CUBEMAP)
        sp(slc, 'cubemap', cube)
    if cube is cube_vis and cube_vis is not cube_env:   # the visible dome as the diffuse light (blender_light's golden rig, --skysrc vis)
        sku_ = float(((cfg.get('night_look') or {}).get('sky')) if (mode == 'night' and (cfg.get('night_look') or {}).get('sky') is not None) else SKY_UE.get(mode, 1.0))   # GLOW45
        sp(slc, 'intensity', (float(SKY_VIS_LIGHT.get(mode, 1.0)) if PH is None else float(PH.get('sky_k', 1.0)) * sku_) * SKY_K * float(os.environ.get('BXUE_SKYK') or 1.0))   # R3-PHYS, R7-SKY (BXUE_SKYK: a test aid)
    else:
        sp(slc, 'intensity', float(LS.get('envIntensity') or data.get('envIntensity') or 1.0) * SKY_ENV_K.get(mode, 2.0) * SKY_K)
    sp(slc, 'real_time_capture', False)
    # R3-PHYS: the dome's lower half lights too, as in Cycles (a ray that leaves the region under the horizon meets the dome's
    # haze, the stand-in for the city beyond); UE blacks it out by default (the deck's underside lost its sky term: 64, 58,
    # 45 against Cycles' 94, 94, 88 at t7ArchTrack f054)
    if PH is not None: sp(slc, 'lower_hemisphere_is_black', False)
    # R3-PHYS: the cubemap's yaw. UE's long-lat import puts direction D at column 0.5 + atan2(D.x, -D.y) / 2 pi, so the sky
    # sphere looks the cube up at (V.y, -V.x, V.z) (sky_material); the sky light samples its source cube at Rz(angle) of the
    # world direction (ReflectionEnvironmentShaders.usf), so the same 90 deg turn is an angle of 270: until now the dome lit
    # the scene (and Lumen's reflection misses) turned 90 deg, its warm sunset side off the sun's
    sp(slc, 'source_cubemap_angle', 270.0)
    out['sky'] = {'cubemap': cube.get_path_name() if cube else None, 'intensity': slc.get_editor_property('intensity')}
    if cube_vis is not None:
        m = sky_material(dest, shot, cube_vis)
        sph = spawn(unreal.StaticMeshActor, unreal.Vector(0, 0, 0), None, 'BX_SkySphere')
        smc = sph.static_mesh_component
        smc.set_static_mesh(unreal.load_asset('/Engine/BasicShapes/Sphere'))
        sph.set_actor_scale3d(unreal.Vector(30000, 30000, 30000))   # the engine sphere is 1 m across: 15 km radius
        smc.set_material(0, m)
        k_ = float(SKY_VIS_K.get(mode, 1.0))
        if abs(k_ - 1.0) > 1e-6:
            mi_ = unreal.AssetToolsHelpers.get_asset_tools().create_asset('MI_sky', dest, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
            unreal.MaterialEditingLibrary.set_material_instance_parent(mi_, m)
            unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(mi_, 'Intensity', k_)
            smc.set_material(0, mi_)
        sp(smc, 'cast_shadow', False)
        sp(smc, 'render_custom_depth', True); sp(smc, 'custom_depth_stencil_value', 6)   # the data pass's 'sky' (ue_families.json regions)
        for p in ('affect_distance_field_lighting', 'affect_dynamic_indirect_lighting', 'visible_in_ray_tracing', 'visible_in_reflection_captures'):
            try: sp(smc, p, False)
            except Exception: pass

    # ==== R1C (lane C, 2026-10-11): the trailer's cinematic preset (cfg physsky): a physical sky in place of the captured dome
    # on the sky sphere while the sun is up: UE's sky atmosphere lit by the sun, volumetric clouds (cfg clouds), the sky light
    # capturing the scene in real time so the atmosphere and the clouds light the city; aerial perspective kept short (the
    # owner's rule: no fog over the landmarks). After dark the captured dome stays the sky (the atmosphere is black without
    # its sun).
    if cfg.get('physsky') and sun_vis:
        try:
            if cube_vis is not None:
                sph.set_actor_hidden_in_game(True); sph.set_is_temporarily_hidden_in_editor(True)
            atm = spawn(unreal.SkyAtmosphere, unreal.Vector(0, 0, 0), None, 'BX_Atmosphere')
            ac_ = atm.get_component_by_class(unreal.SkyAtmosphereComponent)
            try: sp(ac_, 'aerial_pespective_view_distance_scale', float(cfg.get('aerial', 0.25)))
            except Exception:
                try: sp(ac_, 'aerial_perspective_view_distance_scale', float(cfg.get('aerial', 0.25)))
                except Exception: pass
            # (HAZE45, 2026-10-15: cfg aerial_start, km: the aerial perspective begins that far from the lens, so the city and
            # its landmarks stay clear and the backdrop's ground 15-40 km out fades into the air instead of a flat tan plane)
            if cfg.get('aerial_start') is not None:
                try: sp(ac_, 'aerial_perspective_start_depth', float(cfg['aerial_start'])); out['aerial_start'] = float(cfg['aerial_start'])
                except Exception as e: out['aerial_start_error'] = f'{type(e).__name__}: {e}'
            sp(lc, 'atmosphere_sun_light', True)
            # (the atmosphere colours the low sun itself: the web's warm sun colour on top of it doubled the warmth (2026-10-11
            # 13:15, the lake a deep orange); half of it kept, the golden hour still golden)
            c0_ = col if isinstance(col, (list, tuple)) and len(col) >= 3 else [1, 1, 1]
            sp(lc, 'light_color', srgb8([0.5 + 0.5 * float(c0_[0]), 0.5 + 0.5 * float(c0_[1]), 0.5 + 0.5 * float(c0_[2])]))
            if cfg.get('clouds'):
                cl_ = spawn(unreal.VolumetricCloud, unreal.Vector(0, 0, 0), None, 'BX_Clouds')
                cm_ = unreal.load_asset('/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst')
                if cm_ is not None: sp(cl_.get_component_by_class(unreal.VolumetricCloudComponent), 'material', cm_)
                # (WATER3, 2026-10-15: the clouds' shadows on the ground and the water, the owner's "project cloud shadows
                # onto the sea surface"; UE's sun casts none by default)
                for p_, v_ in (('cast_cloud_shadows', True), ('cloud_shadow_strength', float(cfg.get('cloud_shadow', 0.8))),
                               ('cloud_shadow_on_surface_strength', 1.0), ('cast_shadows_on_clouds', True)):
                    try: sp(lc, p_, v_)
                    except Exception as e: out.setdefault('cloud_shadow_errors', []).append(f'{p_}: {e}')
                out['cloud_shadows'] = True
            sp(slc, 'source_type', unreal.SkyLightSourceType.SLS_CAPTURED_SCENE)
            sp(slc, 'real_time_capture', not cfg.get('skycap_static'))
            if cfg.get('skycap_static'):   # (FP18 flip A/B: the sky light captured once, not every tick)
                try: slc.recapture_sky()
                except Exception as e: out['skycap_error'] = str(e)
            out['physsky'] = {'clouds': bool(cfg.get('clouds')), 'sky_light': 'captured once' if cfg.get('skycap_static') else 'captured, real time'}
        except Exception as e:
            out['physsky_error'] = f'{type(e).__name__}: {e}'
    elif cfg.get('physsky') and cfg.get('clouds') and mode == 'night':
        # (after dark: the captured dome stays the sky; the clouds over it lit by a moon (an atmosphere light, low, no shadow
        # of its own) and the sky light, the city's glow from under them)
        try:
            mr_ = unreal.MathLibrary.make_rot_from_x(ue_dir([-0.35, -0.6, 0.72]))
            moon = spawn(unreal.DirectionalLight, unreal.Vector(0, 0, 10000), mr_, 'BX_Moon')
            mc_ = moon.get_component_by_class(unreal.DirectionalLightComponent)
            sp(mc_, 'intensity', float(cfg.get('moon', 0.04))); sp(mc_, 'light_color', unreal.Color(r=200, g=215, b=255, a=255))
            sp(mc_, 'cast_shadows', False); sp(mc_, 'atmosphere_sun_light', True)
            cl_ = spawn(unreal.VolumetricCloud, unreal.Vector(0, 0, 0), None, 'BX_Clouds')
            cm_ = unreal.load_asset('/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst')
            if cm_ is not None: sp(cl_.get_component_by_class(unreal.VolumetricCloudComponent), 'material', cm_)
            out['physsky'] = {'clouds': True, 'moon': float(cfg.get('moon', 0.04)), 'sky': 'captured dome'}
        except Exception as e:
            out['physsky_error'] = f'{type(e).__name__}: {e}'
    # ==== R1C end

    # ---- the far ring (/World/Far: the macro city and terrain past the region) casts no shadows, as in the web (its
    # cascades end well inside it): a low sun would otherwise put the street in the far blocks' shadows
    nf = 0
    farn = set(side.get('far') or [])
    for a in els.get_all_level_actors():
        if a.get_actor_label() in farn:
            for c in a.get_components_by_class(unreal.PrimitiveComponent):
                sp(c, 'cast_shadow', False); nf += 1
    out['far_noshadow'] = nf
    out['fill'] = setup_fill(side, LS, mode)
    out['ambient'] = setup_ambient(side, mode) if PH is None else {'off': 'phys'}   # R3-PHYS: no fills
    # ---- street lamps
    out['lamps'] = setup_lamps(side, dest, cfg, LS, night)
    # ---- vehicle headlamps
    out['headlamps'] = setup_headlamps(side, cfg, LS, night, dest)
    out['emit_lights'] = setup_emit_lights(side, mode)   # R8-EMIT
    # ---- film: exposure, grade, bloom, motion blur, Lumen
    out['film'] = setup_film(side, cfg, LS, mode, dest)
    if cfg.get('cine'): out['fog'] = setup_fog(side, cfg, mode)   # R4-CINE
    if cfg.get('cine'): out['fog_sun'] = fog_sun(side, cfg, mode)   # UELOOK10
    out['option_misses'] = sorted(set(MISS))
    out['secs'] = round(time.time() - t0, 1)
    return out


def setup_fill(side, LS, mode):
    """the web's hemisphere lights' ground term (unoccluded in the web) as a shadowless directional light pointing up,
    x FILL_K per time of day (blender_light's structure fill: the undersides the web lights and a ray tracer occludes)."""
    k = float(FILL_K.get(mode, 0.0))
    LJ = _j(os.path.join(side['data'].get('harvest') or '', 'lights.json')) or {}
    hemis = [L for L in LJ.get('lights', []) if L.get('type') == 'HemisphereLight' and L.get('visible', True)]
    if k <= 0 or not hemis: return None
    dn = [sum(float(L.get('intensity') or 0) * float((L.get('groundColor') or L['color'])[c]) for L in hemis) for c in range(3)]
    if max(dn) <= 0: return None
    a = spawn(unreal.DirectionalLight, unreal.Vector(0, 0, 10000), unreal.Rotator(roll=0.0, pitch=90.0, yaw=0.0), 'BX_FillUp')
    lc = a.get_component_by_class(unreal.DirectionalLightComponent)
    sp(lc, 'intensity', k * max(dn)); sp(lc, 'light_color', srgb8(dn)); sp(lc, 'use_temperature', False)
    sp(lc, 'cast_shadows', False); sp(lc, 'affect_global_illumination', False)
    for p_ in ('specular_scale', 'indirect_lighting_intensity'):
        sp(lc, p_, 0.0)
    return {'k': k, 'ground': [round(v, 4) for v in dn]}


def setup_ambient(side, mode):
    """the web's ambient rig, unoccluded as in the web: its hemisphere lights and its IBL dome x environmentIntensity, as
    the irradiance on six axis normals (ue_prep's ambient), each a shadowless directional light from that side (no
    specular, no part in Lumen's bounce), x AMB_K per time of day. UE's sky light stays as a complement (SKY_ENV_K)."""
    A = side.get('ambient') or {}
    k = float(AMB_K.get(mode, 1.0))
    n = 0
    for axis, (pitch, yaw) in (('+y', (-90.0, 0.0)), ('-y', (90.0, 0.0)), ('+x', (0.0, 180.0)), ('-x', (0.0, 0.0)), ('+z', (0.0, -90.0)), ('-z', (0.0, 90.0))):
        E = A.get(axis)
        if not E or k <= 0 or max(E) <= 0: continue
        a = spawn(unreal.DirectionalLight, unreal.Vector(0, 0, 10000), unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw), f'BX_Amb{axis}')
        lc = a.get_component_by_class(unreal.DirectionalLightComponent)
        sp(lc, 'intensity', k * max(E)); sp(lc, 'light_color', srgb8(E)); sp(lc, 'use_temperature', False)
        sp(lc, 'cast_shadows', False); sp(lc, 'affect_global_illumination', False); sp(lc, 'specular_scale', 0.0)
        sp(lc, 'indirect_lighting_intensity', 0.0); sp(lc, 'volumetric_scattering_intensity', 0.0)
        n += 1
    return {'lights': n, 'k': k}


def setup_lamps(side, dest, cfg, LS, night):
    rig = LS.get('lampRig') or {}
    if night < float(rig.get('on', 0.06)): return 0
    fx = rig.get('fixtures') or []
    leg = rig.get('legacy') or {'cd': 165, 'range': 44, 'lin': [1, 0.54, 0.19]}
    gain = float(rig.get('gain', 3.0))
    shape = rig.get('shape') or [0.2, 0.17, 0.33]
    prof = {}
    tmp = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_intermediate_dir()), 'bx_ies')
    os.makedirs(tmp, exist_ok=True)
    for cobra in (True, False):
        V, Hs, cd = throw_profile(shape, cobra)
        p = os.path.join(tmp, f"bxl_{'cobra' if cobra else 'crook'}.ies")
        open(p, 'w').write(ies_text(V, Hs, cd, 'cl24Throw ' + ('cobrahead' if cobra else 'crook')))
        prof[cobra] = import_file(p, f'{dest}/Lights', f"IES_{'cobra' if cobra else 'crook'}")
    path = cam_path(side)
    n = culled = 0
    for s in LS.get('lamps') or []:
        x, y, z, kind, hgt, yaw = s
        if path and min((x - p[0]) ** 2 + (z - p[2]) ** 2 for p in path) > LAMP_CULL ** 2:
            culled += 1; continue
        F = fx[int(kind)] if 0 <= int(kind) < len(fx) else leg
        cobra = yaw is not None and abs(yaw) < 50
        t = max(0.0, min(1.0, (math.hypot(x + 1215, z - 2820) - 180) / 140)); dim = 0.35 + 0.65 * t * t * (3 - 2 * t)
        I = float(F['cd']) * gain * night * dim * LAMP_K
        loc = ue_pos(side, (x, y + hgt - 0.25, z))
        # R3-PHYS: UE reads the IES profile's horizontal angles a quarter turn from Blender's: at +90 deg the night street's
        # light matches the physical Cycles take (t7DinoGlide f000 / f054: buildings L* 32.2 against 32.0, ground 55.7 against
        # 55.8; at 0 deg 25.0 / 28.7 and 44.9 / 51.4, the throw across the street onto the viaduct). BXUE_LAMPYAW: a further turn
        yaw_deg = (-math.degrees(yaw) if cobra else 0.0) + 90.0 + float(os.environ.get('BXUE_LAMPYAW', '0'))
        a = spawn(unreal.PointLight, loc, unreal.Rotator(roll=0.0, pitch=-90.0, yaw=yaw_deg), f'BX_lamp{n}')
        lc = a.get_component_by_class(unreal.PointLightComponent)
        sp(lc, 'intensity_units', unreal.LightUnits.CANDELAS)
        sp(lc, 'intensity', I)
        lin = F.get('lin') or [1, 0.8, 0.6]
        sp(lc, 'light_color', srgb8(lin))
        sp(lc, 'use_temperature', False)
        sp(lc, 'attenuation_radius', float(F.get('range', 60)) * 100.0)
        sp(lc, 'source_radius', 20.0)
        sp(lc, 'use_inverse_squared_falloff', True)
        sp(lc, 'indirect_lighting_intensity', float(os.environ.get('BXUE_LAMPGI') or LAMP_GI))   # R4-NIGHT (BXUE_LAMPGI: a test aid, R7)
        if prof.get(cobra) is not None:
            sp(lc, 'ies_texture', prof[cobra]); sp(lc, 'use_ies_brightness', False)
        try: sp(lc, 'mega_lights_shadow_method', getattr(unreal.MegaLightsShadowMethod, os.environ.get('BXUE_ML_SHADOW') or 'DEFAULT'))   # (BXUE_ML_SHADOW: a test aid)
        except Exception: pass
        n += 1
    return {'lamps': n, 'culled': culled, 'path_points': len(path)}


# R6-GLARE (UE track, 2026-10-08): the headlamps as the web and Cycles draw them, the HL24 low beam (headlamps.js hl24Beam x
# three's spot cone; blender_light.beam_profile, here in pure Python) as an IES profile on a point light, its cut-off just
# under the horizon. As plain spot cones (41 deg about an axis 4 deg down) they lit everything ahead up to 37 deg over the
# horizon: the backs of the trucks ahead and the white road arrows burned to white with spikes (the trailer's "star"
# glare, t7StreetGlide, t8StNickDiveE).
def _sm(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def beam_profile(aim, angle, pen):
    """blender_light.beam_profile: the light's -Z down, the beam axis along horizontal 90 tilted down by aim."""
    V = sorted(set([float(v) for v in range(0, 70, 5)] + [70.0 + i for i in range(10)] + [80.0 + 0.5 * i for i in range(12)] +
                   [round(86.0 + 0.1 * i, 3) for i in range(71)] + [93.5 + 0.5 * i for i in range(14)] + [105.0, 110.0, 120.0, 180.0]))
    Hs = sorted(set([float(h) for h in range(0, 361, 10)] + [30.0 + i for i in range(121)] + [70.0 + 0.5 * i for i in range(81)]))
    ca, sa = math.cos(aim), math.sin(aim)
    coneCos, penCos = math.cos(angle), math.cos(angle * (1 - pen))
    cd = []
    for h in Hs:
        row = []
        hr = math.radians(h)
        for v in V:
            vr = math.radians(v); sv = math.sin(vr)
            dx, dy, dz = -sv * math.sin(hr), -sv * math.cos(hr), -math.cos(vr)
            dF = -ca * dx - sa * dz; fz = max(dF, 1e-3)
            th = math.atan2(dy, fz); tvH = math.atan2(-sa * dx + ca * dz, fz) - aim
            cut = -0.0100 + min(max(th, 0.0), 0.103) * 0.268
            below = _sm(cut + 0.0045, cut - 0.0035, tvH)
            hx, hy = (th - 0.030) / 0.070, (tvH + 0.022) / 0.014
            mx, my = th / 0.22, (tvH + 0.035) / 0.035
            wx, wy = th / 0.45, (tvH + 0.070) / 0.060
            nx = th / 0.70
            beam = below * (math.exp(-(hx * hx + hy * hy)) + 0.35 * math.exp(-(mx * mx + my * my)) + 0.14 * math.exp(-(wx * wx + wy * wy)) +
                            0.04 * math.exp(-(nx * nx)) * _sm(-0.50, -0.10, tvH)) + (1.0 - below) * 0.015 * math.exp(-(wx * wx))
            row.append(100.0 * beam * _sm(coneCos, penCos, dF) if dF > 0 else 0.0)
        cd.append(row)
    return V, Hs, cd


def setup_headlamps(side, cfg, LS, night, dest=None):
    if night < 0.3: return 0
    hl = LS.get('headlamps') or {}
    cd = float(hl.get('cd', 1800)) * night
    ang = float(hl.get('angle', 0.45)); pen = float(hl.get('penumbra', 0.5)); dist = float(hl.get('distance', 60) or 60)
    ies = None   # R6-GLARE
    if hl.get('hl24') and dest and not os.environ.get('BXUE_HLSPOT'):
        tmp = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_intermediate_dir()), 'bx_ies')
        os.makedirs(tmp, exist_ok=True)
        V, Hs, cdt = beam_profile(float(hl.get('aim', 0.021)), ang, pen)
        pf = os.path.join(tmp, 'bxl_hl24.ies'); open(pf, 'w').write(ies_text(V, Hs, cdt, 'HL24 low beam'))
        ies = import_file(pf, f'{dest}/Lights', 'IES_hl24')
    # the cars' actors: the importer names each actor after its prim (i<k> under ue_<instancer>)
    acts = {}
    for a in els.get_all_level_actors():
        par = a.get_attach_parent_actor()
        if par is not None: acts[(par.get_actor_label(), a.get_actor_label())] = a
    # R9-HANG (UE track, 2026-10-08): only the headlamps of the HL_SHADOWED cars nearest the lens at frame 0 cast shadows; a
    # moving light redraws its whole shadow every frame, and 544 of them (t8BusGlide) with the sign lights lost the GPU at the
    # capture's first frame once in four even with real warm-up frames (BXUE_HLSHADOWED: the count)
    near = None
    try:
        c0 = unreal.Vector(*side['camera']['ue'][0]['p'])
        ds = []
        for r in side.get('moving') or []:
            if not r.get('vehicle') or not r.get('lamp'): continue
            parts = r['path'].split('/'); car = acts.get((parts[-2], parts[-1]))
            if car is not None: ds.append((car.get_actor_location().distance(c0), r['path']))
        near = {p_ for _, p_ in sorted(ds)[:int(os.environ.get('BXUE_HLSHADOWED') or HL_SHADOWED)]}
    except Exception:
        near = None
    n = 0
    for r in side.get('moving') or []:
        if not r.get('vehicle') or not r.get('lamp'): continue
        # headlamps on for most of the take, and a car alive for all of it (an attached light does not follow the car's
        # visibility track: a car outside its life would light the street from where it waits)
        if sum(1 for m in r['lamp'] if int(m) & 1) * 2 < len(r['lamp']) or r.get('visible') is not None: continue
        parts = r['path'].split('/')
        car = acts.get((parts[-2], parts[-1]))
        if car is None: continue
        try: anchors = json.loads(r.get('lamps') or '{}')
        except Exception: anchors = {}
        heads = [v for k, v in anchors.items() if str(k).split(':')[0] in ('1', 'head') or str(k).startswith('1')][:2] if isinstance(anchors, dict) else []
        if not heads: heads = [[0.7, 0.7, 2.2], [-0.7, 0.7, 2.2]]
        for i, p in enumerate(heads):
            p = p if isinstance(p, (list, tuple)) else [p.get('x', 0), p.get('y', 0.7), p.get('z', 2.2)]
            if ies is not None:   # R6-GLARE: pointing down, the profile's horizontal 90 (the beam) along the car's +Y (its forward)
                # (UE's IES lookup puts horizontal 90 along the light's -Z axis, so yaw 270 relative to the car; at yaw 90 the beams
                # lit the road behind the cars: t8StNickDiveE f107 ground L* 47.1 against 53.4 at 270 and Cycles' 54.6)
                spot = els.spawn_actor_from_class(unreal.PointLight, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
            else:
                spot = els.spawn_actor_from_class(unreal.SpotLight, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
            spot.set_actor_label(f'BX_head_{parts[-2]}_{parts[-1]}_{i}')
            spot.attach_to_actor(car, '', unreal.AttachmentRule.KEEP_RELATIVE, unreal.AttachmentRule.KEEP_RELATIVE, unreal.AttachmentRule.KEEP_RELATIVE, False)
            # (R6-GLARE: 12 cm ahead of the lamp's anchor, as Cycles places it: inside the housing its shadows let the light out
            # through the gaps only, thin bright rays on the road fanning from each lamp)
            spot.set_actor_relative_location(unreal.Vector(float(p[0]) * 100, (float(p[2]) + 0.12) * 100, float(p[1]) * 100), False, False)
            if ies is not None:
                spot.set_actor_relative_rotation(unreal.Rotator(roll=0.0, pitch=-90.0, yaw=270.0 + float(os.environ.get('BXUE_HLYAW', '0'))), False, False)
                lc = spot.get_component_by_class(unreal.PointLightComponent)
                sp(lc, 'ies_texture', ies); sp(lc, 'use_ies_brightness', False); sp(lc, 'source_radius', 4.0)
            else:
                spot.set_actor_relative_rotation(unreal.Rotator(roll=0.0, pitch=-4.0, yaw=90.0), False, False)
                lc = spot.get_component_by_class(unreal.SpotLightComponent)
                sp(lc, 'outer_cone_angle', math.degrees(ang))
                sp(lc, 'inner_cone_angle', math.degrees(ang) * (1 - pen))
            sp(lc, 'indirect_lighting_intensity', float(os.environ.get('BXUE_HLGI') or HL_GI))   # R4-NIGHT, R9-EMIT: out of Lumen's scene lighting
            sp(lc, 'intensity_units', unreal.LightUnits.CANDELAS)
            sp(lc, 'intensity', cd)
            sp(lc, 'attenuation_radius', dist * 100)
            sp(lc, 'light_color', srgb8([1.0, 0.905, 0.79]))
            sp(lc, 'cast_shadows', near is None or r['path'] in near)   # R9-HANG
            n += 1
    return n


# R8-EMIT (UE track, 2026-10-08): the strong emissive signs (ue_prep emit_lights: the Apollo's marquee and blade, the shops'
# lit signs, the ad screens) as rect lights at night, so they light the sidewalk and the facade under them as the path
# tracer's emitters do. A surface of emission S over A m2 sends S x A on its axis (Cycles renders an emission of strength S
# at radiance S), in the units of the lamps' candela (the street lamps' calibration), x EMIT_K; a square of the same area,
# 0.05 m off the surface, along its normal; 25 m reach. Fitted on tuApolloSweep f000 against the Cycles preview: the
# sidewalk at the Apollo's windows 0.131 against 0.159 (display linear; round 7 0.040), under the marquee 0.052 against
# 0.029 (0.008), at EMIT_K 1 (at 1 / pi the shops' light was left out and nothing moved)
EMIT_K = 1.0
EMIT_REACH = 25.0   # m
# R9-EMIT (UE track, 2026-10-08): knobs for the night hang (t8BusGlide lost the GPU, Xid 109 at engine frame 54, once in
# two with 664 lights and three times in three with 760, the 96 sign lights included; with the sign lights at zero it
# rendered). The headlamps out of Lumen's scene lighting (BXUE_HLGI=0) with only 24 sign lights shadowed (BXUE_EMITSH=24)
# hung as well (12:39), so both stay at round 8's values and the cause is open
HL_GI = LAMP_GI
# R9-HANG (15:20-15:58): capping the shadowed lights (sign lights 16, headlamps of the 32 nearest cars) did not stop
# t8BusGlide's residual hang (15:24) and brightened the night (light through the occluders: the street at frame 11 +16 in
# sRGB mean), so all of them cast shadows again, as in round 8; the caps stay as knobs (BXUE_EMITSH, BXUE_HLSHADOWED)
EMIT_SHADOWED = 96
HL_SHADOWED = 100000   # R9-HANG: the cars nearest the lens whose headlamps cast shadows (setup_headlamps): all


def setup_emit_lights(side, mode):
    if mode != 'night': return 0
    k = float(os.environ.get('BXUE_EMITK') or EMIT_K)
    n = 0
    for e in side.get('emit_lights') or []:
        nrm = e.get('normal') or [0, -1, 0]
        p = [float(e['pos'][i]) + 0.05 * float(nrm[i]) for i in range(3)]
        a = spawn(unreal.RectLight, ue_pos(side, p), unreal.MathLibrary.make_rot_from_x(ue_dir(nrm)), f'BX_emit{n}')
        lc = a.get_component_by_class(unreal.RectLightComponent)
        side_m = max(0.1, math.sqrt(max(float(e.get('area', 0.01)), 0.01)))
        sp(lc, 'intensity_units', unreal.LightUnits.CANDELAS)
        sp(lc, 'intensity', float(e['cd']) * k)
        sp(lc, 'light_color', srgb8(e.get('color') or [1, 1, 1])); sp(lc, 'use_temperature', False)
        sp(lc, 'source_width', side_m * 100.0); sp(lc, 'source_height', side_m * 100.0)
        sp(lc, 'barn_door_angle', 88.0); sp(lc, 'barn_door_length', 0.0)
        sp(lc, 'attenuation_radius', EMIT_REACH * 100.0)
        near = n < int(os.environ.get('BXUE_EMITSH') or EMIT_SHADOWED)   # (R9-EMIT: ue_prep lists them strongest first)
        sp(lc, 'cast_shadows', near)
        sp(lc, 'indirect_lighting_intensity', float(os.environ.get('BXUE_LAMPGI') or LAMP_GI) if near else 0.0)
        n += 1
    return n


def setup_film(side, cfg, LS, mode, dest):
    """the web's film look: an unbound post-process volume with a fixed exposure and, in place of UE's tonemapper, the
    master M_bx_film (three.js r185 AgX at the page's exposure x 2^EV_BIAS, the sRGB encoding, the page's grade: levels,
    S-curve contrast, highlight shoulder, warmth, green tint, saturation, shadow lift, vignette), as blender_light's
    compositor; the motion blur (--mblur, the web's half-frame streak), bloom (the page's strength), Lumen's quality."""
    ppv = els.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    ppv.set_actor_label('BX_Film')
    sp(ppv, 'unbound', True)
    s = ppv.get_editor_property('settings')
    ev = cfg.get('ev')
    ev = float(EV_BIAS.get(mode, 0.0)) if ev is None else float(ev)
    # (GLOW45, cfg night_look {sky, leak, ev}: a photographic night, the walls under a fraction of the sky light the
    # web-matched rig gives them (SKY_UE x4, leaking 0.3: walls as bright as their windows) and the exposure up, so the lit
    # windows clip and the lens's glare (conv_bloom) haloes them as a camera sees a skyline at night)
    nl_ = cfg.get('night_look') or {}
    if mode == 'night' and nl_.get('ev') is not None: ev += float(nl_['ev'])
    ex = float(LS.get('exposure') or side['data'].get('exposure') or 1.0)
    PH = phys(cfg)   # R3-PHYS: the exposure fixed per time of day
    if PH is not None and (PH.get('exposure') or {}).get(mode): ex = float(PH['exposure'][mode])
    g = LS.get('grade') or {}
    bl = LS.get('bloom') or {}
    vals = {
        'auto_exposure_method': unreal.AutoExposureMethod.AEM_MANUAL, 'auto_exposure_bias': 0.0,
        'auto_exposure_apply_physical_camera_exposure': False,
        'motion_blur_amount': float(cfg.get('mblur', 0.5)), 'motion_blur_max': 5.0,
        'film_grain_intensity': 0.0, 'scene_fringe_intensity': 0.0, 'vignette_intensity': 0.0, 'lens_flare_intensity': 0.0,   # R6-GLARE: no flare ghosts
        'local_exposure_highlight_contrast_scale': 1.0, 'local_exposure_shadow_contrast_scale': 1.0,
        'lumen_final_gather_quality': float(cfg.get('fgq') or 2.0), 'lumen_scene_detail': 2.0, 'lumen_scene_lighting_quality': 2.0,
        'lumen_reflection_quality': 2.0, 'lumen_max_trace_distance': 20000.0,
    }
    vals.update(bloom(bl))
    # ==== GLOW45 (2026-10-15, the owner: lit skyscraper windows at night have an unmistakable glow that makes them look
    # real): the lens's own glare (bloom, the halation of a real lens and sensor) as UE's convolution bloom at night and
    # dusk: the image convolved by FFT with the engine's measured lens kernel (a bright core, a wide soft skirt, faint
    # diffraction), every pixel by its energy (threshold -1, physically based) as glass does, in place of the web's
    # Gaussian stack, which smudged; cfg conv_bloom {k: intensity, scale: the kernel's share of the frame}
    cb_ = cfg.get('conv_bloom')
    if cb_ and mode in ('night', 'dusk'):
        vals.update({'bloom_method': unreal.BloomMethod.BM_FFT, 'bloom_intensity': float(cb_.get('k', 1.0)), 'bloom_threshold': -1.0,
                     'bloom_convolution_scale': float(cb_.get('scale', 0.18)), 'bloom_convolution_buffer_scale': 0.5,
                     'bloom_convolution_center_uv': unreal.Vector2D(0.5, 0.5)})
    # ==== GLOW45 end
    # ==== R1C (lane C, 2026-10-11): the trailer's cinematic preset (tools/ue/render_take_cine.json, cfg lumen_q): Lumen's
    # reflections, scene detail and scene lighting at cinematic quality
    lq_ = cfg.get('lumen_q') or {}
    if lq_:
        vals.update({'lumen_reflection_quality': float(lq_.get('reflection', 2.0)), 'lumen_scene_detail': float(lq_.get('scene_detail', 2.0)),
                     'lumen_scene_lighting_quality': float(lq_.get('scene_lighting', 2.0))})
    # ==== R1C end
    if os.environ.get('BXUE_DCB'): vals['lumen_diffuse_color_boost'] = float(os.environ['BXUE_DCB'])   # (R7: a test aid, Lumen's albedo boost)
    lk_ = float(os.environ.get('BXUE_LEAK') or SKY_LEAK.get(mode, 0.0)) if PH is not None else 0.0   # R7-SKY
    if mode == 'night' and (cfg.get('night_look') or {}).get('leak') is not None: lk_ = float(cfg['night_look']['leak'])   # GLOW45
    if lk_ > 0: vals['lumen_skylight_leaking'] = lk_
    # UE13 (UE track, 2026-10-09): the post-process indirect lighting scale (Lumen's bounce and sky light, not the sun's
    # direct light), physical light only, per time of day (GI_PP, none); BXUE_PPGI: a test aid. Measured 2026-10-09 at 1.3 and
    # 1.6 on t7ArchTrack f54: no change at all (Lumen's GI does not take it here), so it stays empty
    gi_ = float(os.environ.get('BXUE_PPGI') or GI_PP.get(mode, 0.0)) if PH is not None else 0.0
    if gi_ > 0: vals['indirect_lighting_intensity'] = gi_
    # UE13 end
    # R3-REFL: Lumen's reflections with hardware ray tracing, lit at the hit (mirror-clear glass and paint show the street,
    # not the surface cache), and the front layer of translucency (the kit's glass) reflected at full quality
    # (R3-PHYS: hit lighting for the GI as well (--raylight HIT_LIGHTING) left the golden deck's underside where it was (61 ->
    # 64 at t7ArchTrack f054; the sky light was the cause) and lit the night viaduct far over Cycles: 40 against 24 L*)
    for k_, v_ in (('reflection_method', 'ReflectionMethod.LUMEN'), ('lumen_ray_lighting_mode', 'LumenRayLightingModeOverride.' + str(cfg.get('raylight') or 'HIT_LIGHTING_FOR_REFLECTIONS'))):
        try:
            en, mem = v_.split('.'); vals[k_] = getattr(getattr(unreal, en), mem)
        except Exception: MISS.append(k_)
    vals['lumen_front_layer_translucency_reflections'] = True
    if cfg.get('cine'):   # R4-CINE: MegaLights' front-layer pass hung the GPU under the temporal samples at night (Xid 109)
        vals['mega_lights_front_layer_translucency'] = False
        # R5-HANG: the front layer of translucency off in the preset (its passes were among the active ones at the night
        # hangs); the kit glass keeps the radiance cache's glossy reflections
        if not os.environ.get('BXUE_CINE_FRONTLAYER'): vals['lumen_front_layer_translucency_reflections'] = False
    done = []
    for k, v in vals.items():
        if sp(s, k, v):
            sp(s, 'override_' + k, True); done.append(k)
    film = None
    base = eal.load_asset('/Game/Bx/M_bx_film')
    if base is not None and not cfg.get('uetonemap'):
        mel = unreal.MaterialEditingLibrary
        ap = f'{dest}/MI_film'
        # R8-FILM (UE track, 2026-10-08): after a master rebuild in the same run the old MI_film stays loaded and its delete
        # fails, which left the take on UE's tonemapper; the surviving instance is then re-parented to the new master
        if eal.does_asset_exist(ap):
            try: eal.delete_asset(ap)
            except Exception: pass
            if eal.does_asset_exist(ap): film = eal.load_asset(ap)
        if film is None:
            film = unreal.AssetToolsHelpers.get_asset_tools().create_asset('MI_film', dest, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        # R8-FILM end
        mel.set_material_instance_parent(film, base)
        grade = {'Sat': g.get('uSat', 1.0), 'Con': g.get('uCon', 0.0), 'Blk': g.get('uBlk', 0.0), 'Wht': g.get('uWht', 1.0), 'Hi': g.get('uHi', 0.0),
                 'Warm': g.get('uWarm', 0.0), 'TintG': g.get('uTintG', 0.0), 'Vig': g.get('uVig', 0.0)}
        C_ = cfg.get('cine') or {}
        if C_:   # R4-CINE: the cinematic preset's grain and a deeper vignette over the page's
            grade['Grain'] = float(C_.get('grain', 0.035)); grade['Vig'] = float(grade.get('Vig') or 0.0) + float(C_.get('vig', 0.22))
        for kv in os.environ.get('BXUE_GRADE', '').split(','):   # a diagnosis aid: k=v overrides of the page's grade
            if '=' in kv: grade[kv.split('=')[0]] = float(kv.split('=')[1])
        for k, v in [('Expo', ex * 2.0 ** ev)] + list(grade.items()):
            mel.set_material_instance_scalar_parameter_value(film, k, float(v or 0.0))
        mel.update_material_instance(film)
        wb = unreal.WeightedBlendables()
        wb.set_editor_property('array', [unreal.WeightedBlendable(weight=1.0, object=film)])
        sp(s, 'weighted_blendables', wb)
    sp(ppv, 'settings', s)
    return {'expo': ex * 2.0 ** ev, 'ev_bias': ev, 'web_exposure': ex, 'tonemapper': 'agx' if film else 'ue', 'set': len(done)}


# the web's bloom mips as UE's Gaussian stages: each mip's spread at 2560 wide (three's UnrealBloomPass: kernel radius 3 ... 11
# px, sigma = radius, cut at the radius, at 1/2 ... 1/32 resolution, each mip blurring the one before: std 2.6, 9.6, 29, 80,
# 201 px) in UE's stage size (percent of the width x BLOOM_SCALE; the engine's kernel is exp(-16.7 (x / r)^2) over a radius of
# half the size: std = size x width / 1156)
BLOOM_SCALE = 3.0
BLOOM_SIZES = [0.39, 1.44, 4.4, 12.0, 30.2]


def bloom(bl):
    """three's UnrealBloomPass (engine.js: its high pass smoothstep(threshold, threshold + smoothWidth) on the linear scene
    before the exposure, five mips, mip i x strength x lerp(f_i, 1.2 - f_i, radius), f = 1.0 ... 0.2) as UE's Gaussian
    bloom: the threshold as the web's (UE's knee, saturate((L - t) / 2), is the web's smoothstep over 2.01), stage i's tint 6
    x strength x the mip's factor (the engine divides the stages' sum by its six), the sixth stage off. The web caps its high
    pass at 4 at night; UE has no cap (the lenses stay at the web's own radiance: ue_families.json emitters)."""
    if not bl.get('enabled', True): return {'bloom_intensity': 0.0}
    st, r = float(bl.get('strength', 0.3)), float(bl.get('radius', 0.4))
    out = {'bloom_method': unreal.BloomMethod.BM_SOG, 'bloom_intensity': 1.0, 'bloom_threshold': float(bl.get('threshold', 0.85)),
           'bloom_size_scale': BLOOM_SCALE}
    for i, (f, size) in enumerate(zip([1.0, 0.8, 0.6, 0.4, 0.2], BLOOM_SIZES)):
        k = 6.0 * st * (f + (1.2 - 2.0 * f) * r)
        out[f'bloom{i + 1}_tint'] = unreal.LinearColor(k, k, k, 1.0); out[f'bloom{i + 1}_size'] = size
    out['bloom6_tint'] = unreal.LinearColor(0.0, 0.0, 0.0, 1.0)
    return out


# R4-CINE: the cinematic preset's light volumetric fog per time of day: density and height falloff of UE's exponential
# height fog (its volumetric part within FOG_DIST m: shafts of the low sun under the viaduct, the lamps' cones at night;
# beyond, the analytic fog capped at FOG_MAX so the sky sphere keeps its colour), the sun's and the lamps' scattering
FOG = {'golden': (0.010, 0.12), 'day': (0.006, 0.12), 'dusk': (0.008, 0.12), 'night': (0.007, 0.12)}
FOG_DIST = 350.0
# (the volumetric part only where it reads and holds: with it at night the GPU hung under the lamps' volumetric shadows and
# the temporal samples, Xid 109; the night keeps the analytic haze)
FOG_VOLUMETRIC = {'golden': True, 'day': True, 'dusk': False, 'night': False}
# (R6-DUSK, UE track 2026-10-08: at dusk too the lamps and headlamps are on and their cones in the volumetric fog read as
# long white streaks down the street, t8StNickDiveE, where the physical Cycles take shows none; the sun is down)
FOG_MAX = 0.12
FOG_CUT = 12000.0   # m (R6-FAR)
FOG_MAX_FAR = 0.45   # (R6-FAR)


# UELOOK10 (2026-10-08): the cinematic fog against a low sun (scTerraceGolden, golden, the lens into the sun): R4-CINE's
# volumetric fog (golden density 0.010, about 4.5x the web's haze, uDensity 0.00022 / m, and its sun lobe at g 0.6) put an
# orange veil of about the sky's own radiance over the whole frame. Per shot, k = how far the lens looks into a low sun
# (the camera's forward against the sun's direction over the take, x the sun's lowness): the volumetric density and the
# sun's scattering in it scale down with k (to x FOG_SUN[0] and x FOG_SUN[1] at k 1) and the analytic fog's cap to
# FOG_SUN[2], while the analytic fog takes the sun's glow along its direction (directional inscattering: the sun's colour x
# FOG_SUN[3] x k, exponent FOG_SUN[4], from FOG_SUN[5] m), so the haze toward the sun is a bright, light veil over the
# skyline as in the web, not a dark orange one. k 0 leaves the fog as it was (every other shot).
FOG_SUN = (0.4, 0.6, 0.45, 1.0, 6.0, 250.0)


def sun_k(side, mode):
    if mode not in ('golden', 'day'): return 0.0
    sd = side['data'].get('sunDir') or [0, 1, 0]
    s = [float(sd[0]), float(sd[2]), float(sd[1])]   # UE axes (x, z up)
    ls = math.sqrt(sum(v * v for v in s)) or 1.0
    s = [v / ls for v in s]
    low = 1.0 - smooth(0.35, 0.6, s[2])
    if low <= 0.0: return 0.0
    al = []
    for c in (side.get('camera') or {}).get('ue') or []:
        f = c.get('f') or [1, 0, 0]
        lf = math.sqrt(sum(float(v) ** 2 for v in f)) or 1.0
        d = sum(float(f[i]) / lf * s[i] for i in range(3))
        al.append(smooth(math.cos(math.radians(75.0)), math.cos(math.radians(25.0)), d))
    if not al: return 0.0
    al.sort()
    return round(low * al[int(0.75 * (len(al) - 1))], 3)


def fog_sun(side, cfg, mode):
    k = float(os.environ.get('BXUE_FOGSUNK') or sun_k(side, mode))   # (BXUE_FOGSUNK: a test aid)
    if k <= 0.0: return {'k': 0.0}
    fc = sl = None
    for a in els.get_all_level_actors():
        lab = a.get_actor_label()
        if lab == 'BX_Fog': fc = a.get_component_by_class(unreal.ExponentialHeightFogComponent)
        elif lab == 'BX_Sun': sl = a.get_component_by_class(unreal.DirectionalLightComponent)
    if fc is None: return {'k': k, 'fog': None}
    d0 = float(fc.get_editor_property('fog_density'))
    m0 = float(fc.get_editor_property('fog_max_opacity'))
    sp(fc, 'fog_density', d0 * (1.0 + (FOG_SUN[0] - 1.0) * k))
    sp(fc, 'fog_max_opacity', m0 + (min(FOG_SUN[2], m0) - m0) * k)
    col = side['data'].get('sunColor') or [1, 1, 1]
    mx = max(float(v) for v in col[:3]) or 1.0
    sp(fc, 'directional_inscattering_luminance', unreal.LinearColor(*[float(v) / mx * FOG_SUN[3] * k for v in col[:3]], 1.0))
    sp(fc, 'directional_inscattering_exponent', FOG_SUN[4])
    sp(fc, 'directional_inscattering_start_distance', FOG_SUN[5] * 100.0)
    if sl is not None: sp(sl, 'volumetric_scattering_intensity', 1.0 + (FOG_SUN[1] - 1.0) * k)
    return {'k': k, 'density': [d0, round(d0 * (1.0 + (FOG_SUN[0] - 1.0) * k), 5)], 'max_opacity': round(m0 + (min(FOG_SUN[2], m0) - m0) * k, 3)}
# UELOOK10 end


def setup_fog(side, cfg, mode):
    """an exponential height fog with volumetric fog at street level (the take's ground, z 0 in UE's world)."""
    for a in els.get_all_level_actors():
        if a.get_actor_label() == 'BX_Fog': els.destroy_actor(a)
    dens, fall = FOG.get(mode, (0.006, 0.12))
    C_ = cfg.get('cine') or {}
    dens *= float(C_.get('fog', 1.0))
    if dens <= 0: return {'off': True}
    f = spawn(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0), None, 'BX_Fog')
    fc = f.get_component_by_class(unreal.ExponentialHeightFogComponent)
    sky = (side.get('sky') or {}).get('vis_mean') or [0.6, 0.7, 0.9]
    # R6-FAR: the cap raised to FOG_MAX_FAR so the far ring hazes with distance (tuHudsonSwoop: the far city's boxes softer,
    # every region's gate as at 0.12), with the sky sphere (15 km) past the fog's cutoff so the sky keeps its colour
    # (BXUE_FOGMAX: a test aid)
    fmax = float(os.environ.get('BXUE_FOGMAX') or FOG_MAX_FAR)
    if fmax > FOG_MAX: sp(fc, 'fog_cutoff_distance', FOG_CUT * 100.0)
    for k, v in (('fog_density', dens), ('fog_height_falloff', fall), ('fog_max_opacity', fmax), ('start_distance', 0.0),
                 ('fog_inscattering_luminance', unreal.LinearColor(*[float(x) * 0.5 for x in sky[:3]], 1.0)),
                 ('enable_volumetric_fog', bool(FOG_VOLUMETRIC.get(mode, True))), ('volumetric_fog_scattering_distribution', 0.6),
                 ('volumetric_fog_albedo', unreal.Color(r=235, g=235, b=235, a=255)), ('volumetric_fog_extinction_scale', 1.0),
                 ('volumetric_fog_distance', FOG_DIST * 100.0), ('volumetric_fog_start_distance', 0.0)):
        sp(fc, k, v)
    n = 0
    for a in els.get_all_level_actors():
        lab = a.get_actor_label()
        if lab == 'BX_Sun' or lab.startswith('BX_lamp'):
            for c in a.get_components_by_class(unreal.LightComponent):
                sp(c, 'volumetric_scattering_intensity', 1.0); n += 1
    return {'density': dens, 'falloff': fall, 'distance_m': FOG_DIST, 'max_opacity': fmax, 'lights': n, 'volumetric': bool(FOG_VOLUMETRIC.get(mode, True))}


def key_focus(ls, cam, side, cfg):
    """R4-CINE: the cinematic preset's depth of field: the cine camera focused on the take's subject, its distance keyed per
    frame (cfg cine.focus, metres per frame from the take's own depth: ue_frames.py --focus), at cine.fstop."""
    C_ = cfg.get('cine') or {}
    cc = cam.get_cine_camera_component() if hasattr(cam, 'get_cine_camera_component') else cam.get_component_by_class(unreal.CineCameraComponent)
    foc = {int(k): float(v) for k, v in (C_.get('focus') or {}).items()}
    fs = cc.get_editor_property('focus_settings')
    if not foc:   # GB43: no focus keyed, no depth of field (20 m at the preset's f-stop blurred every aerial)
        sp(fs, 'focus_method', unreal.CameraFocusMethod.DISABLE); sp(cc, 'focus_settings', fs)
        return {'fstop': float(C_.get('fstop', 2.8)), 'keys': 0, 'dof': 'off (no focus keyed)'}
    sp(fs, 'focus_method', unreal.CameraFocusMethod.MANUAL)
    sp(fs, 'manual_focus_distance', (foc[min(foc)] if foc else 20.0) * 100.0)
    sp(cc, 'focus_settings', fs)
    sp(cc, 'current_aperture', float(C_.get('fstop', 2.8)))
    out = {'fstop': float(C_.get('fstop', 2.8)), 'keys': 0}
    if not foc: return out
    try:
        cb = ls.add_possessable(cc)
        tr = cb.add_track(unreal.MovieSceneFloatTrack)
        tr.set_property_name_and_path('ManualFocusDistance', 'FocusSettings.ManualFocusDistance')
        f0 = side['frames'][0]
        sec = tr.add_section(); sec.set_range(0, len(side['camera']['ue']))
        ch = sec.get_all_channels()[0]
        for f in sorted(foc):
            ch.add_key(unreal.FrameNumber(f - f0), foc[f] * 100.0, 0.0, unreal.MovieSceneTimeUnit.DISPLAY_RATE, unreal.MovieSceneKeyInterpolation.AUTO)
            out['keys'] += 1
        out['range_m'] = [round(min(foc.values()), 2), round(max(foc.values()), 2)]
    except Exception as e:
        out['error'] = str(e)[:160]
    return out


def camera_settings(cam, side, cfg, seqs=()):
    """the USD camera as the web's lens: the authored apertures and focal length (the importer scales both by the stage's
    units and clamps the focal length), no depth of field; a focal-length or filmback track of the importer's is removed
    unless the USD animates the focal length."""
    cc = cam.get_cine_camera_component() if hasattr(cam, 'get_cine_camera_component') else cam.get_component_by_class(unreal.CineCameraComponent)
    out = {}
    try:
        fs = cc.get_editor_property('focus_settings'); sp(fs, 'focus_method', unreal.CameraFocusMethod.DISABLE)
        sp(cc, 'focus_settings', fs); out['dof'] = 'off'
    except Exception as e:
        out['dof_err'] = str(e)
    c = side.get('camera') or {}
    if c.get('hap'):
        fb = cc.get_editor_property('filmback')
        sp(fb, 'sensor_width', float(c['hap'])); sp(fb, 'sensor_height', float(c['vap']))
        sp(cc, 'filmback', fb)
        ls = cc.get_editor_property('lens_settings')
        sp(ls, 'min_focal_length', 1.0); sp(ls, 'max_focal_length', 5000.0)
        sp(ls, 'min_f_stop', 1.0); sp(ls, 'max_f_stop', 32.0)
        sp(cc, 'lens_settings', ls)
        sp(cc, 'current_focal_length', float(c['focal']))
    removed = 0
    if not c.get('focal_animated'):
        for s in seqs:
            if s is None: continue
            for b in s.get_bindings():
                for t in list(b.get_tracks()):
                    pn = ''
                    try: pn = str(t.get_property_name())
                    except Exception: pass
                    if pn in ('CurrentFocalLength', 'Filmback', 'LensSettings', 'CurrentAperture', 'FocusSettings') or pn.startswith('Filmback'):
                        b.remove_track(t); removed += 1
    out['tracks_removed'] = removed
    try:
        fb = cc.get_editor_property('filmback')
        out['filmback'] = [fb.sensor_width, fb.sensor_height]; out['focal'] = cc.get_editor_property('current_focal_length')
    except Exception:
        pass
    return out


def _rot(f, u):
    return unreal.MathLibrary.make_rot_from_xz(unreal.Vector(*f), unreal.Vector(*u))


def _unwrap(vals):
    out = []
    for v in vals:
        if out:
            while v - out[-1] > 180: v -= 360
            while v - out[-1] < -180: v += 360
        out.append(v)
    return out


def take_camera(side, cfg):
    """a CineCameraActor of the take's own (BX_Camera, unattached) at the USD camera's frame-0 pose."""
    for a in els.get_all_level_actors():
        if a.get_actor_label() == 'BX_Camera': els.destroy_actor(a)
    c0 = side['camera']['ue'][0]
    cam = els.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(*c0['p']), _rot(c0['f'], c0['u']))
    cam.set_actor_label('BX_Camera')
    return cam


def key_camera(ls, binding, side):
    """the take camera's transform keyed every frame in world space (linear), from ue_prep's camera.ue."""
    U = side['camera']['ue']
    f0 = side['frames'][0]
    tr = binding.add_track(unreal.MovieScene3DTransformTrack)
    sec = tr.add_section(); sec.set_range(0, len(U))
    ch = sec.get_all_channels()
    rots = [_rot(c['f'], c['u']) for c in U]
    cols = [[c['p'][0] for c in U], [c['p'][1] for c in U], [c['p'][2] for c in U],
            _unwrap([r.roll for r in rots]), _unwrap([r.pitch for r in rots]), _unwrap([r.yaw for r in rots])]
    lin = unreal.MovieSceneKeyInterpolation.LINEAR
    for i in range(6):
        for k, v in enumerate(cols[i]):
            ch[i].add_key(unreal.FrameNumber(k), float(v), 0.0, unreal.MovieSceneTimeUnit.DISPLAY_RATE, lin)
    for i in range(6, 9):
        ch[i].add_key(unreal.FrameNumber(0), 1.0, 0.0, unreal.MovieSceneTimeUnit.DISPLAY_RATE, lin)
    return {'frames': len(U), 'p0': U[0]['p'], 'rot0': [rots[0].roll, rots[0].pitch, rots[0].yaw]}


def check_moving_tracks(seq, side):
    """how many of the moving instances the importer's sequence animates (transform / visibility tracks)."""
    if seq is None: return None
    seqs = [seq]
    for tr in seq.get_tracks() if hasattr(seq, 'get_tracks') else seq.get_master_tracks():
        if isinstance(tr, unreal.MovieSceneSubTrack):
            for sec in tr.get_sections():
                s = sec.get_sequence()
                if s is not None: seqs.append(s)
    nT = nV = nB = 0
    for s in seqs:
        for b in s.get_bindings():
            nB += 1
            for t in b.get_tracks():
                if isinstance(t, unreal.MovieScene3DTransformTrack): nT += 1
                elif isinstance(t, unreal.MovieSceneVisibilityTrack): nV += 1
    return {'sequences': len(seqs), 'bindings': nB, 'transform_tracks': nT, 'visibility_tracks': nV,
            'moving_animated': sum(1 for r in side.get('moving') or [] if not r.get('still'))}
