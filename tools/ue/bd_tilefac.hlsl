// BD40 (backdrop lane): the frame of the tiles' facade master's code (tools/ue/bd_tilefac_port.py fills it from the page's
// own program; tools/ue/bd_tilefac.py builds the master). Inputs: UV0 the facade's uv (wall metres, height above the
// building's base), UV1-UV2 aux, UV3-UV4 aux2, UV5 + UV6.x aux3, UV6.y + UV7 the vertex colour (tools/ue/r1c_glbuv.py),
// WPA the pixel's absolute world position and CAM the camera's (cm), NWS the vertex normal (world), the take's night and
// weather, the sun the records carry, the TQ32 region, the facade's textures. Outputs: the return value (base colour),
// Emis, Rough, Metal, Spec, NrmW (a world-space normal: the material's tangent-space normal is off).
struct BDH {
  // GB43: the page's derivative fades (a window, a mullion, a joint collapsed to its mean once it nears a pixel) were made
  // for one sample a pixel; Unreal's frames take 8 jittered samples, so they fade at a fraction of the width (AAK)
  // (S125, v95: 0.6, the details fading a little sooner: at 0.35 the rooms and panes of the towers flickered from frame to
  // frame on a moving lens, 51 frames of Broadway's opening over Times Square)
  float fwk(float x) { return fwidth(x) * 0.6; }
  float2 fwk(float2 x) { return fwidth(x) * 0.6; }
  float3 fwk(float3 x) { return fwidth(x) * 0.6; }
  float gmod(float x, float y) { return x - y * floor(x / y); }
  float hash12(float2 p) { float3 p3 = frac(float3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return frac((p3.x + p3.y) * p3.z); }
  float vnoise(float2 p) {
    float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(hash12(i), hash12(i + float2(1, 0)), f.x), lerp(hash12(i + float2(0, 1)), hash12(i + float2(1, 1)), f.x), f.y);
  }
  float fbm(float2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.7) * 0.25 + vnoise(p * 7.1) * 0.15; }
  float pcovI(float x, float lo, float hi) { return floor(x) * (hi - lo) + clamp(frac(x) - lo, 0.0, hi - lo); }
  float pcov(float x, float lo, float hi, float w) {
    w = max(w, 1e-5);
    return clamp((pcovI(x + 0.5 * w, lo, hi) - pcovI(x - 0.5 * w, lo, hi)) / w, 0.0, 1.0);
  }
  float wlh(float a, float b) {
    float s = gmod(a * 127.0 + b * 311.0 + 7.0, 4093.0);
    s = gmod(s * s + 1153.0, 4093.0);
    s = gmod(s * 137.0 + 59.0, 4093.0);
    s = gmod(s * s + 2411.0, 4093.0);
    return s * (1.0 / 4093.0);
  }
  float wlsg(float a, float b) { return wlh(a, b) * 2.0 - 1.0; }
  float fresnelR(float cosT, float f0) { return f0 + (1.0 - f0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0); }
  // (the page's painted reflections: Unreal reflects for itself)
  float3 skyLook(float3 R, float3 sunD, float3 sunC, float3 zenC, float3 horC, float gain, float aur) { return float3(0.0, 0.0, 0.0); }
  float sunDisc(float3 R, float3 sunD, float rough, float fp) { return 0.0; }
  // three.js's world (x east, y up, z south, metres) and Unreal's (x, y, z up, cm): the same axes with y and z swapped
  float3 tw2ue(float3 d) { return float3(d.x, d.z, d.y); }
  // three.js's view space (x right, y up, z towards the viewer) from a world direction, and back; Unreal's view z looks away
  float3 V3(float3 dTW) { float3 v = mul(float4(tw2ue(dTW), 0.0), View.TranslatedWorldToView).xyz; return float3(v.x, v.y, -v.z); }
  float3 W3(float3 v3) { float3 w = mul(float4(v3.x, v3.y, -v3.z, 0.0), View.ViewToTranslatedWorld).xyz; return tw2ue(w); }
};
BDH H;
float2 vFUv = UV0;
float4 vAux = float4(UV1, UV2);
float4 vAux2 = float4(UV3, UV4);
float3 vAux3 = float3(UV5, UV6.x);
float3 vWP = H.tw2ue(WPA * 0.01);
float3 cameraPosition = H.tw2ue(CAM * 0.01);
float3 vNormal = H.V3(normalize(H.tw2ue(NWS)));
float3 vViewPosition = -H.V3(vWP - cameraPosition);
float night = NightV, wet = WetV, snowA = SnowV, uTimeF = TimeF;
float3 sunDirW = normalize(SunD.xyz), sunColW = SunC.xyz;
float lbRoof = LbRoof, lb14Roof = Lb14Roof;
float uRefl = 0.0;
float3 uZenC = float3(0.28, 0.40, 0.57), uHorC = float3(0.62, 0.69, 0.76);
float4 tq32C = Tq32C; float tq32On = Tq32On;
const bool RS30 = true;
float3 FAC_emis = float3(0.0, 0.0, 0.0); float FAC_rough = 0.92; float3 FAC_nrmAdj = float3(0.0, 0.0, 0.0);
float FAC_dbg = 0.0; float3 FAC_dbgV = float3(0.0, 0.0, 0.0); float3 FAC_grainV = float3(1.0, 1.0, 1.0);
float3 FAC_glassF = float3(0.045, 0.55, 0.5); float3 FAC_reflTint = float3(1.0, 1.0, 1.0); float FAC_spand = 0.0;
float FAC_sunK = 1.0; float FAC_metal = 0.0;
float UE_glass = 0.0, UE_f0 = 0.04;
// FP18 (v105): the glass layer (end of the program): the share of the pixel that is pane (UE_gm: the window less its sash,
// reveal, painted mullions, spandrel and AC unit), the spandrel glass's share, the pane's pixel footprint, its cell and seed
float UE_gm = 0.0, UE_sp = 0.0, UE_aa = 1.0, UE_pU = 0.0, UE_pV = 0.0, UE_pS = 0.0, UE_fx = 0.5, UE_fy = 0.5, UE_gs = 0.0;
float4 diffuseColor = float4(UV6.y, UV7.x, UV7.y, 1.0) * float4(Tint.rgb, 1.0);
// ---- the page's colour block
      {

        FAC_emis = ((float3)(0.0)); FAC_rough = 0.92; FAC_nrmAdj = ((float3)(0.0)); FAC_dbg = 0.0; FAC_dbgV = ((float3)(0.0)); FAC_spand = 0.0; FAC_grainV = ((float3)(1.0));
        float floorH = vAux.x, winW = vAux.y, storeH = vAux.z, style = vAux.w;
        float bldgH = vAux2.x, litAmt = vAux2.y, flags = vAux2.w;
        float cvar = floor(vAux2.z * 1024.0 + 0.5) * (1.0 / 1024.0);
        bool cornice = H.gmod(flags, 2.0) >= 1.0;
        bool blind = H.gmod(floor(flags / 2.0), 2.0) >= 1.0;
        if (blind && vAux2.x > 36.0 && vFUv.y > 26.0) blind = false;
        // (S125 v101: and any up-facing surface: a tile roof cap without the flag drew the wall code with collapsed facade uv,
        // streaks across it, Broadway frame 907)
        bool isRoof = H.gmod(floor(flags / 4.0), 2.0) >= 1.0 || normalize(NWS).z > 0.7;
        bool store = H.gmod(floor(flags / 8.0), 2.0) >= 1.0;
        bool mech = H.gmod(floor(flags / 16.0), 2.0) >= 1.0;
        bool crownF = H.gmod(floor(flags / 32.0), 2.0) >= 1.0;
        bool avLight = mech && crownF;
        bool sidingS = style > 13.5 && style < 14.5;
        bool condoS = style > 14.5 && style < 15.5;
        float faceH = H.gmod(floor(flags / 64.0), 2.0) >= 1.0 ? vAux3.z : 0.0;
        bool faceIn = H.gmod(floor(flags / 128.0), 2.0) >= 1.0;
        float3 albedo = diffuseColor.rgb * (0.92 + 0.16 * cvar);
        float u = vFUv.x, v = vFUv.y;
        bool fGlass = (style > 2.5 && style < 3.5) || (style > 10.5 && style < 11.5);
        float famR = H.hash12(float2(floor(cvar * 233.0), 31.7));
        float3 famAlb;
        if (fGlass) {
          if (famR < 0.30) {
            famAlb = float3(0.036, 0.028, 0.021); FAC_glassF = float3(0.26, 0.055, 1.9);
            FAC_reflTint = float3(1.06, 0.95, 0.80);
          } else if (famR < 0.62) {
            famAlb = float3(0.030, 0.052, 0.055); FAC_glassF = float3(0.15, 0.045, 1.6);
            FAC_reflTint = float3(0.82, 0.98, 1.02);
          } else if (famR < 0.84) {
            famAlb = float3(0.052, 0.056, 0.062); FAC_glassF = float3(0.10, 0.038, 1.5);
            FAC_reflTint = float3(0.97, 0.99, 1.02);
          } else {
            famAlb = float3(0.062, 0.050, 0.030); FAC_glassF = float3(0.30, 0.060, 2.1);
            FAC_reflTint = float3(1.10, 0.98, 0.74);
          }
        } else {
          famAlb = ((float3)(1.0)); FAC_glassF = float3(0.045, 0.55, 0.5);
          FAC_reflTint = ((float3)(1.0));
        }
        if (!isRoof && v < 0.02) {
          float course = step(0.5, frac(v / 0.42));
          float blocks = H.hash12(float2(floor(u / 1.1), floor(v / 0.42) + cvar * 41.0));
          albedo = lerp(float3(0.32, 0.28, 0.24), float3(0.42, 0.38, 0.33), blocks) * (0.85 + 0.1 * course);
          FAC_rough = 0.96;
        } else if (isRoof) {
          float2 rp = vWP.xz;
          if (abs(vAux3.x) + abs(vAux3.y) + abs(vAux3.z) > 1e-4) {
            float2 dR = vWP.xz - vAux3.yz;
            float cR = cos(vAux3.x), sR = sin(vAux3.x);
            rp = float2(cR * dR.x + sR * dR.y, -sR * dR.x + cR * dR.y);
          }
          float membF = vAux.z;
          float kindR = H.hash12(float2(floor(cvar * 253.0), 7.31));
          if (membF > 0.5 && membF < 3.5) kindR = membF < 1.5 ? 0.2 : membF < 2.5 ? 0.5 : 0.7;
          float wear = H.fbm(rp * 0.13 + cvar * 19.0);
          float rFp = max(H.fwk(rp.x), H.fwk(rp.y));
          float microVis = RS30 ? smoothstep(0.08, 0.025, rFp) : smoothstep(0.5, 0.12, rFp);
          float rScl = 1.0 + lb14Roof * 0.30 * (H.hash12(float2(floor(cvar * 173.0), 5.17)) * 2.0 - 1.0);
          float rVal = 1.0 + lb14Roof * 0.27 * (H.hash12(float2(floor(cvar * 311.0), 13.9)) * 2.0 - 1.0);
          float micro = lerp(0.5, H.vnoise(rp * 5.0 * rScl + cvar * 7.0), microVis);
          float blotch = H.fbm(rp * 0.31 * (2.0 - rScl) + cvar * 11.0);
          float rollW = 0.914;
          float rollV = rp.y / rollW;
          float rollAA = max(H.fwk(rollV), 1e-4);
          float rollEnv = smoothstep(0.6, 0.18, rollAA);
          float rollVis = RS30 ? smoothstep(0.15, 0.05, rollAA) : rollEnv;
          float seamRaw = smoothstep(0.045 + rollAA, 0.0, abs(frac(rollV) - 0.5) * 2.0 - 0.93);
          float seamL = (RS30 ? lerp(0.95, seamRaw, rollVis) : seamRaw) * rollEnv;
          float rollTint = (H.hash12(float2(floor(rollV), cvar * 53.0)) - 0.5) * 0.03 * rollVis;
          float3 roofC;
          bool patterned = false;
          bool copperF = false;
          if (membF > 6.5 && membF < 7.5) {
            float sx = vFUv.x / 0.46;
            float sAA = max(H.fwk(sx), 1e-4);
            float sEnv = smoothstep(0.75, 0.22, sAA);
            float sVis = RS30 ? smoothstep(0.171, 0.0667, sAA) : sEnv;
            float sd = abs(frac(sx) - 0.5) * 2.0;
            float rib = smoothstep(0.86 - sAA, 0.95, sd) * sVis;
            float ribLit = smoothstep(0.80 - sAA, 0.88, sd) * (1.0 - rib) * sVis;
            float pan = floor(sx);
            float hy = vFUv.y;
            float3 base = diffuseColor.rgb;
            float pT = (H.hash12(float2(pan, cvar * 97.0)) - 0.5) * (RS30 ? smoothstep(0.5, 0.2, sAA) : 1.0);
            float blt = H.fbm(float2(vFUv.x, hy) * 0.28 + cvar * 13.0);
            float strk = H.vnoise(float2(vFUv.x * 1.6 + cvar * 31.0, hy * 0.20));
            float strkV = RS30 ? smoothstep(0.45, 0.15, H.fwk(vFUv.x * 1.6)) : 1.0;
            float3 cu = base * (0.92 + 0.12 * pT + 0.22 * (blt - 0.5));
            cu = lerp(cu, base * float3(0.70, 0.80, 0.74), lerp(0.10, smoothstep(0.58, 0.88, strk), strkV) * 0.42);
            cu = lerp(cu, base * float3(0.46, 0.44, 0.38), smoothstep(0.55, 0.0, hy) * 0.40);
            cu *= 1.0 - rib * 0.24;
            cu *= 1.0 + ribLit * 0.07;
            if (RS30) cu *= 1.0 - (sEnv - sVis) * 0.017;
            roofC = cu;
            FAC_rough = 0.76 + 0.08 * blt;
            patterned = true;
            copperF = true;
          } else if (membF > 5.5) {
            float crs = vWP.y / 0.34;
            float cAA = max(H.fwk(crs), 1e-4);
            float cLine = smoothstep(0.1 + cAA, 0.0, abs(frac(crs) - 0.5) * 2.0 - 0.8);
            float shTint = H.hash12(float2(floor(crs), floor(rp.x * 1.4) + cvar * 31.0));
            float cVis = RS30 ? smoothstep(0.34, 0.12, cAA) : 1.0;
            shTint = lerp(0.5, shTint, cVis);
            roofC = lerp(float3(0.14, 0.15, 0.17), float3(0.2, 0.21, 0.24), shTint) * (1.0 - lerp(0.30, cLine * 0.35, cVis));
            FAC_rough = 0.75;
            patterned = true;
          } else if (membF > 4.5) {
            float sed = H.fbm(rp * 0.8 + cvar * 5.0);
            float dry = smoothstep(0.72, 0.95, H.vnoise(rp * 1.7 + cvar * 9.0));
            float3 g1 = float3(0.20, 0.28, 0.12), g2 = float3(0.36, 0.34, 0.16), g3 = float3(0.32, 0.24, 0.15);
            roofC = lerp(lerp(g1, g2, smoothstep(0.3, 0.72, sed)), g3, dry);
            roofC *= 0.92 + 0.2 * lerp(0.5, H.vnoise(rp * 7.0), RS30 ? smoothstep(0.05, 0.016, rFp) : microVis);
            FAC_rough = 0.97;
            patterned = true;
          } else if (membF > 3.5) {
            float2 pv = rp / 0.6;
            float2 pAA = max(H.fwk(pv), ((float2)(1e-4)));
            float jx = smoothstep(0.05 + pAA.x, 0.0, abs(frac(pv.x) - 0.5) * 2.0 - 0.9);
            float jz = smoothstep(0.05 + pAA.y, 0.0, abs(frac(pv.y) - 0.5) * 2.0 - 0.9);
            float pTint = H.hash12(floor(pv) + cvar * 43.0);
            float pVis = RS30 ? smoothstep(0.2, 0.067, max(pAA.x, pAA.y)) : 1.0;
            pTint = lerp(0.5, pTint, pVis);
            roofC = lerp(float3(0.42, 0.405, 0.38), float3(0.52, 0.5, 0.468), pTint) * (1.0 - lerp(0.297, max(jx, jz) * 0.3, pVis)) * (0.8 + 0.25 * wear);
            FAC_rough = 0.9;
            patterned = true;
          } else if (kindR < 0.34) {
            float3 rSil = lerp(float3(0.5, 0.495, 0.475), float3(0.585, 0.575, 0.54), blotch);
            float3 rMid = float3(0.5425, 0.535, 0.5075);
            rSil = lerp(rSil, rMid + (rSil - rMid) * 3.4, lb14Roof);
            roofC = rSil * (0.8 + 0.22 * wear) * lbRoof * rVal;
            roofC *= 0.96 + 0.08 * micro;
            FAC_rough = 0.6 + wear * 0.22 + blotch * 0.1;
          } else if (kindR < 0.62) {
            roofC = lerp(float3(0.085, 0.085, 0.09), float3(0.12, 0.115, 0.11), blotch) * (0.9 + 0.2 * wear);
            roofC *= 0.94 + 0.12 * micro;
            FAC_rough = 0.62 + blotch * 0.2;
          } else if (kindR < 0.85) {
            float grv = lerp(0.5, H.vnoise(rp * 11.0), RS30 ? smoothstep(0.035, 0.011, rFp) : microVis);
            roofC = lerp(float3(0.28, 0.255, 0.222), float3(0.39, 0.365, 0.322), grv) * (0.84 + 0.22 * wear);
            roofC *= 0.94 + 0.12 * blotch;
            FAC_rough = 0.98;
          } else {
            roofC = lerp(float3(0.24, 0.245, 0.255), float3(0.29, 0.295, 0.30), blotch) * (0.9 + 0.16 * wear);
            roofC *= 0.97 + 0.06 * micro;
            FAC_rough = 0.85;
          }
          if (!patterned) {
            float2 pcQ = rp / 3.6 + cvar * 53.0;
            float2 pc = floor(pcQ);
            float pr = H.hash12(pc);
            if (pr < 0.02) {
              float2 pf = frac(pcQ);
              float2 pin = float2(0.18 + H.hash12(pc + 7.0) * 0.14, 0.18 + H.hash12(pc + 13.0) * 0.14);
              float pe = min(min(pf.x - pin.x, 1.0 - pin.x - pf.x), min(pf.y - pin.y, 1.0 - pin.y - pf.y));
              float inP = smoothstep(0.0, 0.05, pe);
              roofC = lerp(roofC, roofC * 0.6, inP * 0.9);
              roofC = lerp(roofC, roofC * 1.3 + ((float3)(0.02)), smoothstep(0.05, 0.0, pe) * step(-0.04, pe) * 0.5);
            }
          }
          roofC *= 1.0 - smoothstep(0.55, 0.95, wear) * 0.25;
          if (!patterned) {
            float pond = H.fbm(rp * 0.24 + cvar * 31.0);
            float ponW = smoothstep(0.36, 0.76, pond);
            roofC *= 1.0 - ponW * 0.28;
            FAC_rough = lerp(FAC_rough, 0.46, ponW * 0.5);
            float rim = smoothstep(0.24, 0.37, pond) * (1.0 - smoothstep(0.37, 0.54, pond));
            roofC = lerp(roofC, roofC * float3(1.18, 0.96, 0.72), rim * 0.6);
            if (H.hash12(floor(rp / 2.6 + cvar * 71.0)) > 0.97) roofC = lerp(roofC, float3(0.24, 0.14, 0.09), rim * 0.4 + 0.06);
          }
          if (!patterned) {
            float rimD = vFUv.x > 0.5 ? vFUv.x - 1.0 : 99.0;
            if (rimD < 1.16) {
              float rN = 0.45 + 0.55 * H.fbm(rp * 0.55 + cvar * 43.0);
              roofC *= 1.0 - smoothstep(1.15, 0.0, rimD) * rN * 0.34;
              roofC = lerp(roofC, roofC * float3(0.72, 0.70, 0.68), smoothstep(0.42, 0.0, rimD) * 0.7);
              FAC_rough = lerp(FAC_rough, 0.72, smoothstep(0.5, 0.0, rimD) * 0.5);
            }
            float2 dC = rp / 21.0 + cvar * 29.0;
            float2 dId = floor(dC);
            if (H.hash12(dId + 3.1) < 0.52) {
              float2 dOff = float2(H.hash12(dId + 8.7), H.hash12(dId + 15.3)) * 0.66 + 0.17;
              float dS = 0.75 + 0.60 * H.hash12(dId + 21.9);
              float dR = length((frac(dC) - dOff) * 21.0) / dS;
              roofC *= 1.0 - smoothstep(5.0, 1.1, dR) * 0.13;
              roofC = lerp(roofC, roofC * 1.22 + ((float3)(0.022)), smoothstep(0.62, 1.35, dR) * smoothstep(2.0, 1.35, dR) * 0.4);
              roofC = lerp(roofC, float3(0.055, 0.052, 0.048), smoothstep(1.25, 0.42, dR) * 0.78);
              FAC_rough = lerp(FAC_rough, 0.55, smoothstep(1.1, 0.3, dR) * 0.6);
            }
          }
          if (!patterned) roofC *= (1.0 - seamL * 0.05) * (1.0 + rollTint);
          // (S125: the roof's tone wanders over 6 to 25 m, as weathered and patched membrane does)
          roofC *= 1.0 + 0.18 * (H.fbm(rp * 0.045 + cvar * 3.1) - 0.5) + 0.08 * (H.fbm(rp * 0.17 + cvar * 9.7) - 0.5);
          albedo = roofC;
          if (!copperF && diffuseColor.g > diffuseColor.r * 1.25 && diffuseColor.g > diffuseColor.b * 1.12) {
            albedo = diffuseColor.rgb * (0.85 + 0.2 * blotch + 0.1 * micro);
            FAC_rough = 0.6;
          }
          if (snowA > 0.003) {
            float rsm = clamp(snowA * (0.5 + 0.9 * (H.vnoise(vWP.xz * 0.42) * 0.5 + H.vnoise(vWP.xz * 0.09) * 0.5)), 0.0, 1.0);
            albedo = lerp(albedo, float3(0.87, 0.895, 0.94), rsm);
            FAC_rough = lerp(FAC_rough, 0.62, rsm);
          }
        } else if (!blind) {
          bool glassStyle = (style > 2.5 && style < 3.5) || (style > 10.5 && style < 11.5);
          bool loftStyle = (style > 5.5 && style < 7.5);
          float wallLen = max(vAux3.x, 0.01);
          float wallSeed = floor(vAux3.y * 128.0 + 0.5) * (1.0 / 128.0);
          float bayN = floor((wallLen - 0.44) / winW);
          float sideM = (wallLen - max(bayN, 0.0) * winW) * 0.5;
          float cuC = (u - sideM) / winW, cvC = v / floorH;
          float fx = frac(cuC), fy = frac(cvC);
          float cellU = floor(cuC), cellV = floor(cvC);
          float cellUS = cellU + wallSeed * 37.0;
          bool inBay = bayN >= 1.0 && cuC >= 0.0 && cuC < bayN;
          float x0 = 0.2, x1 = 0.8, y0 = 0.3, y1 = 0.88;
          if (glassStyle) { x0 = 0.05; x1 = 0.95; y0 = 0.08; y1 = 0.96; }
          if (loftStyle) { x0 = 0.1; x1 = 0.9; y0 = 0.14; y1 = 0.92; }
          if (sidingS) { x0 = 0.30; x1 = 0.70; y0 = 0.28; y1 = 0.80; }
          if (condoS) { x0 = 0.10; x1 = 0.90; y0 = 0.16; y1 = 0.94; }
          float aaU = max(H.fwk(cuC), 1e-4), aaV = max(H.fwk(cvC), 1e-4);
          float xb0 = x0, xb1 = x1, yb0 = y0, yb1 = y1;
          float cvI = floor(vAux2.z * 1024.0 + 0.5);
          float wlDC = vAux3.z >= 8.0 ? floor(vAux3.z / 8.0) - 1.0 : -1.0;
          float wlPin = (cellU == wlDC) ? 0.0 : 1.0;
          float bk = clamp(cellU, 0.0, 4090.0) + 1.0;
          float off = H.wlsg(cvI + 17.0, bk) * 0.028 * wlPin;
          float wsc = 1.0 + H.wlsg(cvI + 53.0, bk) * 0.026 * wlPin;
          float bkv = H.gmod(cellU, 64.0) + H.gmod(cellV, 64.0) * 64.0 + 1.0;
          float sJ = H.wlsg(cvI + 89.0, bkv) * (0.02 / max(floorH, 2.0));
          float lJ = H.wlsg(cvI + 131.0, bkv) * (0.02 / max(floorH, 2.0));
          x0 = 0.5 + (x0 - 0.5) * wsc + off;
          x1 = 0.5 + (x1 - 0.5) * wsc + off;
          y0 += sJ; y1 += lJ;
          float jFade = smoothstep(0.30, 0.09, aaU);
          x0 = lerp(xb0, x0, jFade); x1 = lerp(xb1, x1, jFade);
          y0 = lerp(yb0, y0, jFade); y1 = lerp(yb1, y1, jFade);
          float hwU = aaU * 0.625, hwV = aaV * 0.625;
          float covU = lerp(H.pcov(cuC, xb0, xb1, aaU * 1.25),
                           clamp((min(fx + hwU, x1) - max(fx - hwU, x0)) / max(2.0 * hwU, 1e-5), 0.0, 1.0), jFade);
          float covV = lerp(H.pcov(cvC, yb0, yb1, aaV * 1.25),
                           clamp((min(fy + hwV, y1) - max(fy - hwV, y0)) / max(2.0 * hwV, 1e-5), 0.0, 1.0), jFade);
          float winMask = covU * covV;
          if (v > bldgH - 0.8 || v < 0.15 || !inBay) winMask = 0.0;
          float doorPack = vAux3.z;
          float doorCell = floor(doorPack / 8.0) - 1.0;
          float doorColI = H.gmod(floor(doorPack / 2.0), 4.0);
          bool doorWall = doorPack >= 8.0 && bayN >= 1.0 && !store && !glassStyle && wallLen > 3.6;
          if (doorWall && cellU == doorCell && v < 3.6) winMask = 0.0;
          float wlBrick = 0.0;
          if (!glassStyle && inBay && bayN >= 2.0 && H.wlh(cvI + 211.0, 3.0) < 0.38) {
            float endB = (cellU < 0.5 || cellU > bayN - 1.5) ? 1.0 : 0.0;
            float colR = H.wlh(cvI + 307.0, clamp(cellU, 0.0, 4090.0) + 1.0);
            float opR = H.wlh(cvI + 401.0, bkv);
            float rate = lerp(0.025, 0.20, endB);
            float br = (opR < rate || colR < 0.05) ? 1.0 : 0.0;
            if (doorWall && cellV < 1.5) br = 0.0;
            if (cellU == wlDC) br = 0.0;
            br *= jFade;
            wlBrick = br * winMask;
            winMask *= 1.0 - br;
          }
          float tiny = smoothstep(0.28, 0.62, max(aaU, aaV));
          UE_aa = max(aaU, aaV); UE_pU = cellU; UE_pV = cellV; UE_pS = cvI + wallSeed * 37.0; UE_fx = fx; UE_fy = fy; UE_gs = glassStyle ? 1.0 : 0.0;
          bool inWin = winMask > 0.5 && tiny < 0.9;
          float winFade = 1.0 - tiny;
          if (store && v < storeH) {
            FAC_dbg = 2.0;
            float band = storeH * 0.78;
            if (v > band) {
              float shopW = 7.0;
              float shopI = floor(u / shopW);
              float fa = 1.0 + 2.0 * floor(H.hash12(float2(cvar * 131.0, 3.7)) * 32.0);
              float fb = floor(H.hash12(float2(cvar * 57.0 + wallSeed * 13.0, 9.1)) * 64.0);
              float slot = H.gmod(fa * shopI + fb, 64.0);
              float sCol = H.gmod(slot, 4.0);
              float sRow = floor(slot / 4.0);
              float su = clamp((u - shopI * shopW) / shopW, 0.0, 1.0);
              float sv = clamp((v - band) / max(storeH - band, 0.01), 0.0, 1.0);
              float2 sUV = float2((sCol + su) * (1.0 / 4.0),
                              1.0 - (sRow + 1.0 - sv) * (1.0 / 16.0));
              float3 sgn = Texture2DSample(Tsgn, TsgnSampler, sUV).rgb;
              float sVis = smoothstep(0.34, 0.06, max(H.fwk(u), H.fwk(v)));
              float3 sMean = lerp(float3(0.14, 0.13, 0.13), sgn, 0.35);
              float3 signCol = lerp(sMean, sgn, sVis);
              albedo = signCol;
              FAC_emis += signCol * (night * (0.75 + 0.8 * H.hash12(float2(shopI, cvar)))
                                   + (1.0 - night) * 0.10);
              FAC_rough = 0.52;
            } else {
              float bayS = floor(u / 4.0);
              float dust0 = H.vnoise(float2(u * 0.3, v * 0.5 + cvar * 5.0)) * 0.3;
              float gate = H.hash12(float2(bayS, cvar * 37.0));
              if (gate < 0.22) {
                float slat = frac(v * 17.0);
                float sFw = H.fwk(v) * 17.0;
                float sAA = clamp(sFw, 1e-4, 0.45);
                float ribV = smoothstep(0.50 - sAA, 0.50 + sAA, slat)
                           * (1.0 - smoothstep(0.86 - sAA, 0.86 + sAA, slat));
                float rib = lerp(0.36, ribV, smoothstep(0.95, 0.25, sFw));
                float gTone = 0.30 + 0.34 * H.hash12(float2(bayS * 3.3 + 7.0, cvar * 91.0));
                float3 gCol = lerp(((float3)(gTone)), float3(gTone * 1.06, gTone * 0.99, gTone * 0.90),
                                step(0.62, H.hash12(float2(bayS * 1.9, cvar * 23.0))));
                albedo = gCol * (0.80 + 0.30 * rib);
                albedo = lerp(albedo, albedo * 0.42, smoothstep(band - 0.55, band - 0.18, v));
                float tg = H.hash12(float2(bayS * 11.0, cvar * 53.0));
                if (tg < 0.34) albedo = lerp(albedo, float3(0.12, 0.10, 0.16),
                  smoothstep(0.55, 0.9, H.vnoise(float2(u * 2.6, v * 3.4) + tg * 40.0)) * 0.55);
                FAC_rough = 0.62;
              }
              else {
                float litS = step(0.18, H.hash12(float2(bayS + 31.0, cvar * 71.0)));
                float3 sLight = H.hash12(float2(bayS, cvar * 3.0)) < 0.88
                  ? lerp(float3(0.87, 0.92, 1.0), float3(0.93, 0.96, 1.0), gate)
                  : lerp(float3(1.0, 0.85, 0.6), float3(1.0, 0.92, 0.75), gate);
                float3 NnS = normalize(vNormal);
                float3 rayS = normalize(-vViewPosition);
                float3 upS = normalize(H.V3(float3(0.0, 1.0, 0.0)));
                float3 TvS = normalize(cross(NnS, upS));
                float3 BvS = normalize(cross(NnS, TvS));
                if (dot(BvS, upS) < 0.0) BvS = -BvS;
                float dotNS = dot(rayS, -NnS);
                float grazeS = smoothstep(0.05, 0.17, dotNS);
                float3 rdS = float3(dot(rayS, TvS), dot(rayS, BvS), max(0.04, dotNS));
                float RWs = 4.0, RHs = max(1.6, band - 0.5), RDs = RHs * 2.4 + 1.5;
                float rxS = clamp(u - bayS * 4.0, 0.0, RWs);
                float ryS = clamp(v - 0.45, 0.0, RHs);
                float txS = rdS.x > 0.0 ? (RWs - rxS) / max(rdS.x, 1e-4) : rxS / max(-rdS.x, 1e-4);
                float tyS = rdS.y > 0.0 ? (RHs - ryS) / max(rdS.y, 1e-4) : ryS / max(-rdS.y, 1e-4);
                float tzS = RDs / rdS.z;
                float tS = min(txS, min(tyS, tzS));
                float3 hS = float3(rxS, ryS, 0.0) + rdS * tS;
                float3 qS = float3(hS.x / RWs, hS.y / RHs, hS.z / RDs);
                float qdS = max(H.fwk(qS.x), max(H.fwk(qS.y), H.fwk(qS.z)));
                float roomVisS = smoothstep(0.06, 0.015, qdS);
                float eAAS = clamp(qdS * 1.5, 0.004, 0.08);
                float3 shopWall = lerp(float3(0.55, 0.52, 0.48), float3(0.66, 0.64, 0.6), gate);
                float3 room;
                if (tS == tzS) {
                  float shelf = smoothstep(0.82 - eAAS * 5.0, 0.82 + eAAS * 5.0, frac(qS.y * 5.0));
                  float gRow = floor(qS.y * 5.0);
                  float gCol = floor(qS.x * 12.0);
                  float3 goods = 0.20 + 0.34 * float3(H.hash12(float2(gCol, gRow * 3.1 + bayS)),
                                                  H.hash12(float2(gRow * 1.7 + bayS, gCol)),
                                                  H.hash12(float2(gCol * 3.0 + 5.0, gRow + cvar * 77.0)));
                  goods = lerp(((float3)(dot(goods, ((float3)(0.33))))), goods, 0.55);
                  float bkd = H.hash12(float2(bayS * 7.7 + 2.0, cvar * 61.0));
                  if (bkd < 0.34) {
                    float3 card = lerp(float3(0.30, 0.29, 0.27), float3(0.52, 0.50, 0.47), bkd * 2.4);
                    float pos = step(0.18, frac(qS.x * 2.0)) * step(0.28, qS.y) * step(qS.y, 0.82);
                    float3 poster = 0.30 + 0.45 * float3(H.hash12(float2(floor(qS.x * 2.0), bayS + 3.0)),
                                                     H.hash12(float2(bayS + 9.0, floor(qS.x * 2.0))),
                                                     H.hash12(float2(floor(qS.x * 2.0) * 7.0, cvar * 13.0)));
                    goods = lerp(card, lerp(card, poster, 0.7), pos);
                    shelf *= 0.15;
                  }
                  float3 stocked = lerp(lerp(shopWall * 0.7, goods, 0.6), shopWall * 0.45, shelf);
                  room = lerp(shopWall * 0.6, stocked, roomVisS);
                } else if (tS == tyS) {
                  if (rdS.y < 0.0) {
                    float tile = smoothstep(0.93 - eAAS * 6.0, 0.93 + eAAS * 6.0, max(frac(qS.x * 6.0), frac(qS.z * 6.0)));
                    float3 terr2 = lerp(lerp(float3(0.5, 0.47, 0.43), float3(0.58, 0.56, 0.52), H.hash12(floor(float2(qS.x, qS.z) * 6.0))), ((float3)(0.2)), tile);
                    float cM = smoothstep(0.12 + eAAS, 0.12 - eAAS, abs(qS.z - 0.55)) * smoothstep(0.3 + eAAS, 0.3 - eAAS, abs(qS.x - 0.62));
                    terr2 *= lerp(1.0, 0.45, cM * roomVisS);
                    room = lerp(float3(0.5, 0.47, 0.43), terr2, roomVisS);
                  } else {
                    float troffer = smoothstep(0.6 - eAAS * 3.0, 0.6 + eAAS * 3.0, frac(qS.x * 3.0)) * smoothstep(0.35 - eAAS * 2.0, 0.35 + eAAS * 2.0, frac(qS.z * 2.0));
                    room = lerp(((float3)(0.62)), sLight * lerp(0.8, 5.0, litS), troffer * 0.8 * lerp(0.35, 1.0, roomVisS));
                  }
                } else { room = shopWall * 0.75; }
                room *= lerp(1.0, 0.5, qS.z);
                float glowS = litS * lerp(0.5, 1.0, night);
                room *= (0.22 * (1.0 - night) + glowS * 1.4 + 0.03);
                room = lerp(room, room * sLight, litS * 0.6);
                float detVisS = smoothstep(0.95, 0.15, H.fwk(u)) * grazeS;
                float3 shopMean = shopWall * (0.22 * (1.0 - night) + glowS * 1.2 + 0.03) * 0.6;
                {
                  float syS = clamp((v - 0.45) / max(band - 0.95, 0.5), 0.0, 1.0);
                  float prof = lerp(0.40, 1.0, smoothstep(0.04, 0.40, syS))
                             * lerp(1.0, 0.52, smoothstep(0.60, 1.0, syS));
                  shopMean *= prof * (0.72 + 0.56 * H.hash12(float2(bayS * 5.1 + 3.0, cvar * 13.0)));
                }
                room = lerp(shopMean, room, detVisS);
                float sfA = 1.0;
                {
                  float sfT = 1.0 - smoothstep(180.0, 320.0, length(vWP.xz - float2(-1215.0, 2820.0)));
                  if (sfT > 0.0) {
                    float sfU = u - bayS * 4.0, sfH = max(band - 0.55, 0.5);
                    float sfY = clamp((v - 0.45) / sfH, 0.0, 1.0);
                    float sfW = max(H.fwk(u), H.fwk(v)) + 1e-4, sfEu = sfW * 1.2, sfEv = sfEu / sfH;
                    float sfNear = smoothstep(0.45, 0.12, sfW);
                    float sfK = H.hash12(float2(bayS * 5.3 + 1.0, cvar * 17.0));
                    float sfC = H.hash12(float2(bayS * 2.9 + 7.0, cvar * 41.0)), sfC2 = frac(sfC + 0.37 + sfK * 0.25);
                    float3 sfHue = sfC < 0.125 ? float3(0.95, 0.10, 0.08) : sfC < 0.25 ? float3(0.90, 0.08, 0.50) : sfC < 0.375 ? float3(1.0, 0.42, 0.04)
                               : sfC < 0.5 ? float3(1.0, 0.78, 0.08) : sfC < 0.625 ? float3(0.08, 0.72, 0.28) : sfC < 0.75 ? float3(0.04, 0.60, 0.92)
                               : sfC < 0.875 ? float3(0.12, 0.22, 0.95) : float3(0.55, 0.14, 0.92);
                    float3 sfHue2 = sfC2 < 0.25 ? float3(0.98, 0.30, 0.55) : sfC2 < 0.5 ? float3(0.10, 0.85, 0.80) : sfC2 < 0.75 ? float3(1.0, 0.62, 0.10) : float3(0.35, 0.30, 1.0);
                    float3 sfBase = room * 0.35;
                    float3 sfD = sfBase;
                    float sfKind = floor(sfK * 4.0);
                    if (sfKind < 1.0) {
                      float sfG = smoothstep(0.1, 0.0, abs(frac(sfU * 0.22 + sfY * 0.9 + sfK * 7.0) - 0.5) - 0.2);
                      float3 sfCol = lerp(sfHue * 0.42, sfHue2 * 0.42, sfG * 0.55);
                      sfCol = lerp(sfCol, float3(0.5, 0.48, 0.45), (smoothstep((1.1) - sfEu, (1.1) + sfEu, sfU) * (1.0 - smoothstep((2.9) - sfEu, (2.9) + sfEu, sfU)) * smoothstep((0.62) - sfEv, (0.62) + sfEv, sfY) * (1.0 - smoothstep((0.7) - sfEv, (0.7) + sfEv, sfY))));
                      sfD = lerp(sfD, sfCol, (smoothstep((0.35) - sfEu, (0.35) + sfEu, sfU) * (1.0 - smoothstep((3.65) - sfEu, (3.65) + sfEu, sfU)) * smoothstep((0.16) - sfEv, (0.16) + sfEv, sfY) * (1.0 - smoothstep((0.84) - sfEv, (0.84) + sfEv, sfY))));
                    } else if (sfKind < 2.0) {
                      float2 sfQ = float2((sfU - 0.3) / 3.4, (sfY - 0.22) / 0.64);
                      float3 sfCol = lerp(sfHue, sfHue2, smoothstep(0.1, 0.9, sfQ.x * 0.7 + sfQ.y * 0.3)) * 0.45;
                      sfCol += (sfHue2 * 0.3 + 0.08) * smoothstep(0.35, 0.0, length((sfQ - float2(0.62, 0.55)) * float2(1.6, 1.0)));
                      sfD = lerp(sfD, sfCol, (smoothstep((0.3) - sfEu, (0.3) + sfEu, sfU) * (1.0 - smoothstep((3.7) - sfEu, (3.7) + sfEu, sfU)) * smoothstep((0.22) - sfEv, (0.22) + sfEv, sfY) * (1.0 - smoothstep((0.86) - sfEv, (0.86) + sfEv, sfY))));
                    } else if (sfKind < 3.0) {
                      float sfF = 0.0;
                      for (int i = 0; i < 3; i++) {
                        float cx = 0.8 + float(i) * 1.2 + (H.hash12(float2(bayS * 3.0 + float(i), cvar * 9.0)) - 0.5) * 0.3;
                        sfF = max(sfF, max((smoothstep((cx - 0.15) - sfEu, (cx - 0.15) + sfEu, sfU) * (1.0 - smoothstep((cx - 0.03) - sfEu, (cx - 0.03) + sfEu, sfU)) * smoothstep((0.08) - sfEv, (0.08) + sfEv, sfY) * (1.0 - smoothstep((0.31) - sfEv, (0.31) + sfEv, sfY))), (smoothstep((cx + 0.03) - sfEu, (cx + 0.03) + sfEu, sfU) * (1.0 - smoothstep((cx + 0.15) - sfEu, (cx + 0.15) + sfEu, sfU)) * smoothstep((0.08) - sfEv, (0.08) + sfEv, sfY) * (1.0 - smoothstep((0.31) - sfEv, (0.31) + sfEv, sfY)))));
                        sfF = max(sfF, (smoothstep((cx - 0.19) - sfEu, (cx - 0.19) + sfEu, sfU) * (1.0 - smoothstep((cx + 0.19) - sfEu, (cx + 0.19) + sfEu, sfU)) * smoothstep((0.29) - sfEv, (0.29) + sfEv, sfY) * (1.0 - smoothstep((0.5) - sfEv, (0.5) + sfEv, sfY))));
                        sfF = max(sfF, smoothstep(0.1 + sfEu, 0.1 - sfEu, length(float2(sfU - cx, (sfY - 0.555) * sfH))));
                      }
                      float3 sfCol = lerp(sfHue2 * 0.38, ((float3)(0.02)), sfF * sfNear);
                      sfCol = lerp(sfCol, sfHue * 0.42, (smoothstep((0.2) - sfEu, (0.2) + sfEu, sfU) * (1.0 - smoothstep((3.8) - sfEu, (3.8) + sfEu, sfU)) * smoothstep((0.8) - sfEv, (0.8) + sfEv, sfY) * (1.0 - smoothstep((0.88) - sfEv, (0.88) + sfEv, sfY))));
                      sfD = lerp(sfD, sfCol, (smoothstep((0.2) - sfEu, (0.2) + sfEu, sfU) * (1.0 - smoothstep((3.8) - sfEu, (3.8) + sfEu, sfU)) * smoothstep((0.05) - sfEv, (0.05) + sfEv, sfY) * (1.0 - smoothstep((0.88) - sfEv, (0.88) + sfEv, sfY))));
                    } else {
                      sfD = lerp(sfBase, sfBase * sfHue * 2.5, 0.6);
                    }
                    sfD = lerp(sfD, float3(0.5, 0.48, 0.43), (smoothstep((-1.0) - sfEu, (-1.0) + sfEu, sfU) * (1.0 - smoothstep((5.0) - sfEu, (5.0) + sfEu, sfU)) * smoothstep((0.93) - sfEv, (0.93) + sfEv, sfY) * (1.0 - smoothstep((0.97) - sfEv, (0.97) + sfEv, sfY))) * 0.8);
                    float sfFr = max(1.0 - (smoothstep((0.07) - sfEu, (0.07) + sfEu, sfU) * (1.0 - smoothstep((3.93) - sfEu, (3.93) + sfEu, sfU)) * smoothstep((-1.0) - sfEv, (-1.0) + sfEv, sfY) * (1.0 - smoothstep((2.0) - sfEv, (2.0) + sfEv, sfY))), (smoothstep((-1.0) - sfEu, (-1.0) + sfEu, sfU) * (1.0 - smoothstep((5.0) - sfEu, (5.0) + sfEu, sfU)) * smoothstep((0.895) - sfEv, (0.895) + sfEv, sfY) * (1.0 - smoothstep((0.92) - sfEv, (0.92) + sfEv, sfY))));
                    sfD = lerp(sfD, ((float3)(0.012)), sfFr);
                    sfD = lerp(lerp(sfBase, sfHue * 0.35, 0.45), sfD, sfNear);
                    room = lerp(room, sfD, sfT);
                    sfA = lerp(1.0, 0.3, sfT * night);
                  }
                }
                float filmS = 0.12 + dust0 * 0.2;
                float3 shopGlass = float3(0.8, 0.83, 0.81);
                albedo = lerp(room * shopGlass * sfA, float3(0.08, 0.09, 0.095), max(filmS, (1.0 - grazeS) * 0.75));
                {
                  float3 seS = room * shopGlass * glowS * 2.0 * (1.0 - filmS) * grazeS;
                  float tsqS = 1.0 - smoothstep(180.0, 320.0, length(vWP.xz - float2(-1215.0, 2820.0)));
                  FAC_emis += seS * lerp(1.0, min(1.0, 0.85 / max(1e-3, max(seS.r, max(seS.g, seS.b)))), tsqS);
                }
                FAC_rough = 0.1 + filmS * 0.3;
                FAC_rough = lerp(FAC_rough, 0.7, smoothstep(0.15, 0.5, H.fwk(u)));
              }
            }
            {
              float dBelow = band - v;
              if (dBelow > -0.05 && dBelow < 1.05) {
                float dN = 0.30 + 0.70 * H.vnoise(float2(u * 4.3 + cvar * 13.0, v * 0.8));
                float drip = smoothstep(1.0, -0.02, dBelow) * smoothstep(-0.05, 0.03, dBelow) * dN;
                albedo *= 1.0 - drip * 0.34;
                FAC_emis *= 1.0 - drip * 0.30;
              }
              float kick = smoothstep(0.40, 0.05, v);
              albedo = lerp(albedo, albedo * float3(0.30, 0.30, 0.31), kick * 0.72);
              FAC_emis *= 1.0 - kick * 0.85;
              albedo *= 1.0 - smoothstep(0.13, 0.0, v) * 0.35;
              FAC_rough = lerp(FAC_rough, 0.9, kick * 0.7);
            }
          } else if (inWin) {
            FAC_dbg = 1.0;
            UE_gm = 1.0;
            float span = 2.0 + step(0.55, H.hash12(float2(floor(cellUS / 2.0), cellV + cvar * 7.0)));
            float roomI = floor(cellU / span);
            float roomK = roomI + wallSeed * 53.0;
            float id = H.hash12(float2(roomK + cvar * 511.0, cellV * 1.7));
            float id2 = H.hash12(float2(cellV * 3.7 + cvar * 131.0, roomK * 1.3));
            float id3 = H.hash12(float2(roomK * 7.9, cellV * 5.1 + cvar * 57.0));
            float mottleG = H.vnoise(float2(u, v) * 0.3 + cvar * 19.0);
            float dust = H.vnoise(float2(u * 0.3, v * 0.06 + cvar * 5.0)) * 0.3;
            float pooled = smoothstep(0.32, 0.0, (fy - y0) / max(0.001, y1 - y0)) * 0.4;
            float grime = clamp(0.3 + dust + pooled, 0.0, 0.9);
            bool resi = style < 2.5 || (style > 4.5 && style < 5.5) || style > 11.5;
            float litN = smoothstep(0.15, 0.60, night);
            float litFrac = resi ? lerp(0.20, 0.44, litN) : lerp(0.42, 0.56, litN);
            float lit_ = step(1.0 - litFrac, id3);
            {
              float wPh = H.hash12(float2(cellU * 7.3 + wallSeed * 3.0, cellV * 11.1 + cvar * 5.0));
              if (wPh < 0.12) lit_ = step(0.0, sin(uTimeF * (0.011 + wPh * 0.02) + wPh * 251.0));
            }
            float3 lightCol = id2 < 0.88
              ? lerp(float3(1.0, 0.72, 0.27), float3(1.0, 0.89, 0.61), H.hash12(float2(cellU, cellV + 9.0)))
              : lerp(float3(0.87, 0.91, 1.0), float3(0.62, 0.71, 1.0), H.hash12(float2(cellV, cellU + 4.0)));
            {
              float tvR = H.hash12(float2(cellV * 3.9 + cvar * 41.0, cellU * 6.1));
              if (tvR < 0.08) {
                float fl = 0.6 + 0.4 * sin(uTimeF * 9.0 + tvR * 300.0) * sin(uTimeF * 23.7 + tvR * 91.0);
                lightCol = lerp(lightCol, float3(0.55, 0.68, 1.0) * (0.7 + fl * 0.6), night);
              }
            }
            float3 Nn = normalize(vNormal);
            float3 rayV = normalize(-vViewPosition);
            float3 upV = normalize(H.V3(float3(0.0, 1.0, 0.0)));
            float3 Tv = normalize(cross(Nn, upV));
            float3 Bv = normalize(cross(Nn, Tv));
            if (dot(Bv, upV) < 0.0) Bv = -Bv;
            float RW = span * winW, RH = (y1 - y0) * floorH;
            float RD = (resi ? 1.55 : 2.4) * RH + 1.2;
            float dotN = dot(rayV, -Nn);
            float grazeVis = smoothstep(0.05, 0.17, dotN);
            float3 rd = float3(dot(rayV, Tv), dot(rayV, Bv), max(0.04, dotN));
            float REC = glassStyle ? 0.045 : 0.15;
            float2 parS = clamp(rd.xy * (REC / max(rd.z, 0.2)), ((float2)(-0.5)), ((float2)(0.5)));
            float Wp = max((x1 - x0) * winW, 1e-3), Hp = max((y1 - y0) * floorH, 1e-3);
            float pu = (fx - x0) * winW + parS.x;
            float pv = (fy - y0) * floorH + parS.y;
            float aaPm = clamp(aaU * winW, 0.004, 0.09);
            float insU = smoothstep(-aaPm, aaPm, pu) * smoothstep(-aaPm, aaPm, Wp - pu);
            float insV = smoothstep(-aaPm, aaPm, pv) * smoothstep(-aaPm, aaPm, Hp - pv);
            float revealM = (1.0 - insU * insV) * smoothstep(0.08, 0.28, dotN) * (1.0 - tiny);
            float rx = clamp((cuC + parS.x / winW - roomI * span) / span, 0.0, 1.0) * RW;
            float ry = clamp((fy + parS.y / floorH - y0) / (y1 - y0), 0.0, 1.0) * RH;
            float tx = rd.x > 0.0 ? (RW - rx) / max(rd.x, 1e-4) : rx / max(-rd.x, 1e-4);
            float ty = rd.y > 0.0 ? (RH - ry) / max(rd.y, 1e-4) : ry / max(-rd.y, 1e-4);
            float tz = RD / rd.z;
            float t = min(tx, min(ty, tz));
            float3 hit = float3(rx, ry, 0.0) + rd * t;
            float3 q = float3(hit.x / RW, hit.y / RH, hit.z / RD);
            FAC_dbgV = q;
            float qd = max(H.fwk(q.x), max(H.fwk(q.y), H.fwk(q.z)));
            float roomVis = smoothstep(0.06, 0.015, qd);
            float eAA = clamp(qd * 1.5, 0.004, 0.08);
            float3 iWall = lerp(float3(0.62, 0.58, 0.52), float3(0.72, 0.70, 0.66), id2);
            float aoQx = smoothstep(0.0, 0.15, q.x) * smoothstep(0.0, 0.15, 1.0 - q.x);
            float aoQy = smoothstep(0.0, 0.15, q.y) * smoothstep(0.0, 0.15, 1.0 - q.y);
            float aoQz = smoothstep(0.0, 0.15, q.z) * smoothstep(0.0, 0.15, 1.0 - q.z);
            float3 room;
            if (t == tz) {
              room = iWall;
              if (resi) {
                float doorX = lerp(0.22, 0.78, id);
                float doorM = smoothstep(0.09 + eAA, 0.09 - eAA, abs(q.x - doorX)) * smoothstep(0.72 + eAA, 0.72 - eAA, q.y);
                room = lerp(room, lerp(float3(0.32, 0.22, 0.13), float3(0.5, 0.38, 0.24), id2), doorM * roomVis);
                float picX = doorX < 0.5 ? lerp(0.68, 0.82, id2) : lerp(0.18, 0.32, id2);
                float picM = smoothstep(0.05 + eAA, 0.05 - eAA, abs(q.x - picX)) * smoothstep(0.07 + eAA, 0.07 - eAA, abs(q.y - 0.55));
                room = lerp(room, lerp(((float3)(0.2)), lightCol * 0.4, id3), picM * roomVis);
                float sofaX = 0.5 + (id - 0.5) * 0.4;
                float sofaM = smoothstep(0.22 + eAA, 0.22 - eAA, abs(q.x - sofaX)) * smoothstep(0.3 + eAA, 0.3 - eAA, q.y);
                room = lerp(room, lerp(float3(0.24, 0.2, 0.18), float3(0.36, 0.3, 0.26), id2) * 1.15, sofaM * roomVis);
              } else {
                float shC = frac(q.y * 4.0);
                float shelf = smoothstep(0.86 - eAA * 4.0, 0.86 + eAA * 4.0, shC);
                float3 goods = 0.3 + 0.55 * float3(H.hash12(float2(floor(q.x * 8.0), cellV)), H.hash12(float2(cellUS, floor(q.x * 8.0))), H.hash12(float2(floor(q.x * 8.0) * 3.0, cvar * 77.0)));
                float3 shelved = lerp(lerp(iWall * 0.85, goods, 0.5), iWall * 0.55, shelf);
                room = lerp(iWall * 0.72, shelved, roomVis);
              }
              room *= lerp(0.72, 1.0, aoQx * aoQy);
            } else if (t == ty) {
              if (rd.y < 0.0) {
                float seam = smoothstep(0.94 - eAA * 6.0, 0.94 + eAA * 6.0, frac(q.x * 6.0));
                float3 boards = lerp(lerp(float3(0.29, 0.2, 0.125), float3(0.42, 0.3, 0.19), id2), float3(0.12, 0.1, 0.08), seam);
                float rugM = resi ? smoothstep(0.28 + eAA, 0.28 - eAA, abs(q.x - 0.5)) * smoothstep(0.3 + eAA, 0.3 - eAA, abs(q.z - 0.45)) : 0.0;
                boards = lerp(boards, lerp(float3(0.48, 0.23, 0.2), float3(0.23, 0.34, 0.38), id3), rugM);
                room = lerp(float3(0.34, 0.25, 0.16), boards, roomVis);
              } else {
                float lamp = smoothstep(0.16 + eAA, 0.13 - eAA, length(float2(q.x - 0.5, q.z - 0.5)));
                float3 ceilBase = lerp(iWall, ((float3)(1.0)), 0.5);
                room = lerp(ceilBase, lightCol * lerp(1.0, 4.5, lit_), lamp * lerp(0.3, 1.0, roomVis));
              }
              room *= lerp(0.72, 1.0, aoQx * aoQz);
            } else {
              room = iWall * 0.8;
              room *= lerp(0.72, 1.0, aoQy * aoQz);
            }
            float dayAmb = (1.0 - night) * (0.08 + 0.26 * id);
            float roomGlow = lit_ * lerp(0.08, 1.0, night);   // (S125 v101: 0.22 by day lit random panes in the shade, a checkerboard)
            room *= (dayAmb + roomGlow * 1.6 + 0.02) * lerp(1.0, 0.45, q.z);
            room = lerp(room, room * lightCol, lit_ * lerp(0.25, 0.85, night));
            float cwid = pow(id2, 2.0) * 0.42;
            float fxn = clamp(pu / Wp, 0.0, 1.0);
            float aaFx = aaU / max(0.05, x1 - x0);
            float curtM = clamp(smoothstep(cwid + aaFx, cwid - aaFx, fxn) + smoothstep(1.0 - cwid - aaFx, 1.0 - cwid + aaFx, fxn), 0.0, 1.0);
            float3 fab = lerp(float3(0.72, 0.68, 0.6), float3(0.5, 0.55, 0.52), id3) * (dayAmb * 1.6 + roomGlow * 0.2 + 0.02);
            room = lerp(room, fab, curtM);
            float detVis = smoothstep(0.16, 0.05, aaU) * grazeVis;
            float3 roomMean = iWall * (dayAmb + roomGlow * 1.3 + 0.02) * 0.55;
            roomMean = lerp(roomMean, roomMean * lightCol, lit_ * lerp(0.25, 0.85, night));
            room = lerp(roomMean, room, detVis);
            {
              float fyn = clamp(pv / Hp, 0.0, 1.0);
              float aaFy = aaV / max(0.05, y1 - y0);
              float dressR = H.hash12(float2(cellUS * 3.3 + cvar * 97.0, cellV * 9.4));
              float fynS = fyn;
              float dRoom = H.wlh(cvI + 1013.0, H.gmod(floor(cellU / 2.0), 64.0) + H.gmod(cellV, 64.0) * 64.0 + 1.0);
              float dPane = H.wlh(cvI + 1117.0, bkv);
              dressR = dRoom * 0.72 + dPane * 0.28;
              float hRoom = H.wlh(cvI + 1229.0, H.gmod(floor(cellU / 2.0), 64.0) + H.gmod(cellV, 64.0) * 64.0 + 1.0);
              float hFloor = H.wlh(cvI + 1321.0, H.gmod(cellV, 64.0) + 1.0);
              float hPane = H.wlh(cvI + 1433.0, bkv);
              fynS = clamp(fyn + (fxn - 0.5) * H.wlsg(cvI + 1553.0, bkv) * 0.07, 0.0, 1.0);
              if (resi) {
                if (dressR < 0.42) {
                  float shH = lerp(0.15, 0.95, H.hash12(float2(cellV * 5.9 + cvar * 23.0, cellUS * 1.9)));
                  shH = clamp(lerp(0.12, 0.97, hRoom * 0.74 + hPane * 0.26), 0.05, 0.99);
                  float shM = smoothstep(1.0 - shH - aaFy, 1.0 - shH + aaFy, fynS);
                  float3 shC = lerp(float3(0.80, 0.76, 0.68), float3(0.60, 0.59, 0.55), id2);
                  float3 shade = shC * (dayAmb * 1.9 + roomGlow * 0.55 + 0.02);
                  shade *= 0.93 + 0.07 * sin(fxn * 19.0) * smoothstep(0.6, 0.2, fwidth(fxn * 19.0));   // (S125 v100: the folds faded near a pixel)
                  room = lerp(room, shade, shM);
                }
              } else if (dressR < 0.6) {
                float blH = lerp(0.2, 1.0, H.hash12(float2(cellUS * 7.1, cellV * 3.7 + cvar * 51.0)));
                blH = clamp(lerp(0.18, 1.0, hFloor * 0.62 + hRoom * 0.24 + hPane * 0.14), 0.05, 1.0);
                float blM = smoothstep(1.0 - blH - aaFy, 1.0 - blH + aaFy, fynS);
                float slat = H.pcov(fyn * 16.0, 0.0, 0.72, max(fwidth(fyn * 16.0), 1e-4) * 1.5);   // (S125 v100: 1.5 px, the slats shimmered)
                float3 blC = float3(0.72, 0.73, 0.71) * (0.55 + 0.45 * slat);
                room = lerp(room, blC * (dayAmb * 1.7 + roomGlow * 0.4 + 0.02), blM);
              }
            }
            float3 dirtyGlass = lerp(float3(0.05, 0.06, 0.068), float3(0.105, 0.12, 0.128), mottleG);
            float tintR = H.hash12(float2(cellUS * 7.7 + cvar * 43.0, cellV * 3.1));
            float3 glassTint = lerp(float3(0.71, 0.78, 0.75),
              tintR < 0.33 ? float3(0.64, 0.73, 0.78) : tintR < 0.66 ? float3(0.75, 0.78, 0.69) : float3(0.70, 0.74, 0.77),
              0.55) * 0.86;
            albedo = lerp(room * glassTint, dirtyGlass, max(grime * (1.0 - lit_ * 0.35), (1.0 - grazeVis) * 0.75));
            {
              float paneVis = smoothstep(0.95, 0.22, aaU);
              float rv = H.hash12(float2(roomK * 3.7 + cvar * 11.0, cellV * 2.3));
              float fv = H.hash12(float2(cellV * 7.1 + cvar * 29.0, 5.31));
              float pj = H.hash12(float2(cellUS * 11.3 + cvar * 7.0, cellV * 4.9));
              albedo *= 1.0 + ((rv - 0.5) * 0.34 + (fv - 0.5) * 0.16 + (pj - 0.5) * 0.14) * paneVis;
              float tv = H.hash12(float2(roomK * 13.7, cellV * 1.9 + cvar * 83.0));
              albedo *= lerp(((float3)(1.0)), lerp(float3(1.07, 1.0, 0.92), float3(0.92, 0.99, 1.09), tv), 0.4 * paneVis);
            }
            FAC_rough = 0.16 + pooled * 0.45 + dust * 0.2;
            FAC_rough = lerp(FAC_rough, 0.35, smoothstep(0.15, 0.45, aaU));   // (S125 v101: 0.72 from 0.05 made the far panes matte, a dark grid)
            FAC_emis += room * glassTint * roomGlow * 2.2 * (1.0 - grime * 0.6) * grazeVis;
            {
              float wyR = clamp(pv / Hp, 0.0, 1.0);
              float recess = 1.0 - 0.24 * smoothstep(0.62, 0.98, wyR);
              albedo *= recess;
              FAC_emis *= lerp(1.0, recess, 0.4);
            }
            {
              float3 Vw = normalize(cameraPosition - vWP);
              float3 NwG = normalize(cross(ddx(vWP), -ddy(vWP)));
              if (dot(NwG, Vw) < 0.0) NwG = -NwG;
              float pj1 = H.hash12(float2(cellU * 3.1 + wallSeed * 11.0, cellV * 5.3)) - 0.5;
              float pj2 = H.hash12(float2(cellV * 9.7 + cvar * 31.0, cellU * 1.7)) - 0.5;
              float3 Nj = normalize(NwG + float3(pj1, pj2, pj1 * 0.5) * 0.055);
              float3 Rw = reflect(-Vw, Nj);
              float fres = 0.05 + 0.95 * pow(1.0 - max(dot(Vw, Nj), 0.0), 5.0);
              float glassW = winMask * grazeVis * (1.0 - grime * 0.7);
              glassW *= 0.55 + 0.9 * H.hash12(float2(cellUS * 5.3, cellV * 8.9 + cvar * 17.0));
              UE_glass = max(UE_glass, glassW); UE_f0 = fGlass ? FAC_glassF.x : 0.075;
              float f0P = fGlass ? FAC_glassF.x : 0.075;
              float fresP = H.fresnelR(max(dot(Vw, Nj), 0.0), f0P);
              float fpP = max(aaU, aaV) * 0.35;
              float3 mirC = H.skyLook(Rw, sunDirW, sunColW, uZenC, uHorC, uRefl, FAC_glassF.z);
              float skyVis = 1.0;
              {
                float3 NwS = normalize(H.W3(vNormal));
                if (dot(NwS, Vw) < 0.0) NwS = -NwS;
                float3 RwS = reflect(-Vw, normalize(NwS + float3(pj1, pj2, pj1 * 0.5) * 0.055));
                float dn = dot(RwS, NwS);
                float tl = length(NwS.xz);
                float3 tang = float3(-NwS.z, 0.0, NwS.x) / max(tl, 1e-3);
                float wSt = lerp(17.0, 30.0, H.hash12(float2(wallSeed * 7.3 + cvar * 3.1, 2.7)));
                float tHit = wSt / max(dn, 0.03);
                float yHit = vFUv.y + RwS.y * tHit;
                float sHit = dot(vWP + RwS * tHit, tang);
                float fwS = max(H.fwk(sHit), 1e-3), fwY = max(H.fwk(yHit), 1e-3);
                float lot = floor(sHit / 14.0);
                float lh = H.hash12(float2(lot * 1.37 + cvar * 5.3, wallSeed * 3.9 + 0.7));
                float hOpp = clamp(bldgH * lerp(0.55, 1.3, lh), 8.0, 55.0);
                float lc = H.hash12(float2(lot * 4.1 + 9.3, cvar * 2.9));
                float3 wallA = lc < 0.45 ? float3(0.52, 0.30, 0.23) : lc < 0.7 ? float3(0.44, 0.34, 0.28)
                           : lc < 0.88 ? float3(0.70, 0.62, 0.50) : float3(0.52, 0.52, 0.51);
                float bay = lerp(1.6, 2.3, lh), flo = lerp(2.9, 3.5, lc);
                float win = H.pcov(sHit / bay, 0.22, 0.78, fwS / bay) * H.pcov(yHit / flo, 0.32, 0.86, fwY / flo);
                win *= smoothstep(1.5, 3.5, yHit);
                float shop = 1.0 - smoothstep(3.2, 4.2, yHit);
                float3 wallC = uHorC * uRefl * wallA * lerp(1.0, 0.16, max(win * 0.9, shop * 0.75))
                           * (0.85 + 0.35 * clamp(dot(-NwS, sunDirW) * 3.0, 0.0, 1.0) * (1.0 - night));
                float3 roadC = uHorC * uRefl * float3(0.26, 0.26, 0.27);
                float fwH = max(fwY, 0.25);
                float farVis = smoothstep(hOpp - fwH, hOpp + fwH, yHit);
                float onRoad = 1.0 - smoothstep(-fwH, fwH, yHit);
                float3 farC = lerp(wallC, roadC, onRoad);
                float useF = smoothstep(0.5, 0.7, tl) * (1.0 - smoothstep(0.75, 0.9, night));
                skyVis = lerp(1.0, farVis, useF);
                mirC = lerp(mirC, lerp(farC, mirC, farVis), useF);
              }
              FAC_emis += mirC * FAC_reflTint * fresP * glassW;
              FAC_emis += sunColW * FAC_reflTint
                        * H.sunDisc(Rw, sunDirW, fGlass ? FAC_glassF.y : 0.06, fpP)
                        * fresP * 16.0 * uRefl * glassW * (1.0 - night) * skyVis;
            }
            if (!glassStyle && tiny < 0.9) {
              float sashR = H.hash12(float2(floor(cvar * 253.0), 4.17));
              float3 sashC = sashR < 0.5 ? float3(0.66, 0.65, 0.60)
                         : sashR < 0.8 ? float3(0.085, 0.085, 0.095)
                         : float3(0.22, 0.15, 0.10);
              float dEdgeS = min(min(pu, Wp - pu), min(pv, Hp - pv));
              float stileW = 0.055;
              float wlRep = 0.0; float3 wlRepC = ((float3)(0.0));
              {
                float rr = H.wlh(cvI + 613.0, H.gmod(floor(cellU / 2.0), 64.0) + H.gmod(cellV, 64.0) * 64.0 + 1.0);
                float rw = H.wlh(cvI + 727.0, bkv);
                wlRep = (rr < 0.12 && rw < 0.62) || rw < 0.022 ? 1.0 : 0.0;
                if (wlRep > 0.5) {
                  stileW = 0.085;
                  float rc = H.wlh(cvI + 829.0, bkv);
                  wlRepC = rc < 0.62 ? float3(0.80, 0.795, 0.775)
                         : rc < 0.86 ? float3(0.52, 0.53, 0.545)
                         : float3(0.16, 0.145, 0.125);
                  sashC = wlRepC;
                }
              }
              float sashM = smoothstep(stileW + aaPm, stileW - aaPm, dEdgeS);
              if (loftStyle && wlRep < 0.5) {
                float gU = pu / 0.56, gV = pv / 0.47;
                float mUL = 1.0 - H.pcov(gU, 0.05, 0.95, max(H.fwk(gU), 1e-4) * 1.25);
                float mVL = 1.0 - H.pcov(gV, 0.06, 0.94, max(H.fwk(gV), 1e-4) * 1.25);
                sashM = clamp(sashM + mUL + mVL, 0.0, 1.0);
              } else {
                sashM = clamp(sashM + smoothstep(0.045 + aaPm, 0.045 - aaPm, abs(pv - Hp * (wlRep > 0.5 ? 0.50 : 0.53))), 0.0, 1.0);
              }
              sashM *= insU * insV * (1.0 - tiny) * winMask;
              {
                float paneVisU = smoothstep(0.95, 0.22, aaU);
                float paint = H.hash12(float2(floor(cvar * 253.0) + 11.0, 8.3));
                float chalk = smoothstep(0.45, 1.0, paint);
                sashC = lerp(sashC, lerp(sashC, float3(0.52, 0.51, 0.49), 0.55), chalk);
                float hueB = H.hash12(float2(floor(cvar * 253.0) + 29.0, 2.1)) - 0.5;
                sashC *= float3(1.0 + hueB * 0.10, 1.0 + hueB * 0.02, 1.0 - hueB * 0.09);
                float rep = H.hash12(float2(cellUS * 9.1 + cvar * 17.0, cellV * 4.3));
                sashC *= 1.0 + (rep - 0.5) * 0.26 * paneVisU;
                float lowF = smoothstep(0.34, 0.0, pv / max(Hp, 0.01));
                float cornF = smoothstep(0.22, 0.0, min(pu, Wp - pu) / max(Wp, 0.01));
                float dirtF = clamp(lowF * 0.7 + cornF * 0.45, 0.0, 1.0)
                            * (0.30 + 0.70 * H.hash12(float2(floor(cvar * 253.0) + 5.0, 6.7)));
                sashC = lerp(sashC, sashC * float3(0.60, 0.585, 0.55), dirtF * 0.55 * paneVisU);
                FAC_rough = lerp(FAC_rough, lerp(0.38, 0.74, max(chalk, dirtF * 0.6)), sashM);
              }
              if (wlRep > 0.5) {
                sashC = lerp(sashC, wlRepC, 0.75);
                FAC_rough = lerp(FAC_rough, 0.30, sashM);
              }
              UE_gm *= 1.0 - sashM;
              if (sashM > 0.003) {
                albedo = lerp(albedo, sashC, sashM);
                FAC_emis *= 1.0 - sashM * 0.92;
              }
            }
            UE_gm *= 1.0 - revealM;
            if (revealM > 0.003) {
              float dL2 = -pu, dR2 = pu - Wp, dB2 = -pv, dT2 = pv - Hp;
              float mV = max(max(dL2, dR2), max(dB2, dT2));
              float3 rev = diffuseColor.rgb * 0.66;
              if (dT2 >= mV - 1e-5) rev = diffuseColor.rgb * 0.40;
              else if (dB2 >= mV - 1e-5) rev = float3(0.5, 0.47, 0.42) * 1.06;
              rev *= 1.0 - 0.45 * clamp(mV / max(REC, 1e-3), 0.0, 1.0);
              albedo = lerp(albedo, rev, revealM);
              FAC_emis *= (1.0 - revealM);
              FAC_rough = lerp(FAC_rough, 0.85, revealM);
            }
            if (glassStyle) {
              float mullA = smoothstep(0.045 - aaU, 0.045 + aaU, fx) * (1.0 - smoothstep(0.955 - aaU, 0.955 + aaU, fx))
                          * smoothstep(0.05 - aaV, 0.05 + aaV, fy) * (1.0 - smoothstep(0.95 - aaV, 0.95 + aaV, fy));
              float3 mullCol = diffuseColor.rgb * 0.45;
              albedo = lerp(mullCol, albedo, mullA);
              FAC_emis *= mullA;
              FAC_rough = lerp(0.55, FAC_rough, mullA);
              UE_gm *= mullA;
              if (fy < 0.3 && fy > 0.05 && style > 2.5 && style < 3.5) { albedo = diffuseColor.rgb * 0.55; FAC_emis = ((float3)(0.0)); FAC_rough = 0.4; UE_gm = 0.0; UE_sp = 1.0; }
              {
                float fin = 1.0 - tiny;
                float litF = smoothstep(0.955 - aaU, 0.955 + aaU, fx) * (1.0 - smoothstep(0.985 - aaU, 0.985 + aaU, fx));
                float shF = 1.0 - smoothstep(0.012 + aaU, 0.03 + aaU, fx);
                float castF = smoothstep(0.045 - aaU, 0.045 + aaU, fx) * (1.0 - smoothstep(0.075, 0.075 + 2.0 * aaU, fx));
                albedo *= 1.0 + fin * (0.55 * litF - 0.35 * shF - 0.22 * castF);
                if (style > 10.5 && style < 11.5 && fy > 0.05 && fy < 0.17) {
                  float spM = fin * smoothstep(0.05, 0.05 + aaV, fy) * (1.0 - smoothstep(0.17 - aaV, 0.17, fy));
                  albedo = lerp(albedo, diffuseColor.rgb * 0.62, spM); FAC_emis *= 1.0 - spM; FAC_rough = lerp(FAC_rough, 0.45, spM);
                  UE_gm *= 1.0 - spM; UE_sp = max(UE_sp, spM);
                }
              }
              float3 cwAvg = lerp(diffuseColor.rgb * 0.5, float3(0.10, 0.125, 0.14), 0.55);
              albedo = lerp(albedo, cwAvg, tiny);
              UE_gm = lerp(UE_gm, 0.8, tiny);
              FAC_emis *= (1.0 - tiny * 0.7);
              if (doorPack >= 8.0 && cellU == doorCell && v < 3.9 && tiny < 0.8) {
                float inP = H.pcov(cuC, 0.5 - 0.38, 0.5 + 0.38, aaU * 1.25) * (1.0 - smoothstep(3.35, 3.6, v));
                float frameB = clamp(max(1.0 - H.pcov(cuC, 0.5 - 0.30, 0.5 + 0.30, aaU * 1.25), smoothstep(3.1, 3.35, v)), 0.0, 1.0);
                float frameM = inP * frameB;
                albedo = lerp(albedo, float3(0.05, 0.055, 0.06), frameM);
                FAC_emis *= 1.0 - frameM;
                FAC_rough = lerp(FAC_rough, 0.35, frameM);
                float inDoor = inP * (1.0 - frameB);
                if (inDoor > 0.003) {
                  float stile = 1.0 - smoothstep(0.015, 0.045, abs(fx - 0.5));
                  float pushb = smoothstep(0.98, 1.02, v) * (1.0 - smoothstep(1.1, 1.14, v));
                  albedo = lerp(albedo, float3(0.05, 0.055, 0.06), inDoor * clamp(stile + pushb, 0.0, 1.0));
                  FAC_emis += float3(1.0, 0.75, 0.45) * inDoor * (0.3 + night * 1.2);
                }
              }
            } else {
              float fill = (x1 - x0) * (y1 - y0);
              float3 punchAvg = lerp(diffuseColor.rgb * 0.98, float3(0.06, 0.07, 0.08), fill * 0.85);
              albedo = lerp(albedo, punchAvg, tiny);
              UE_gm *= 1.0 - tiny;
              FAC_emis *= max(winFade, 0.25);
              FAC_rough = lerp(FAC_rough, 0.85, tiny);
              albedo *= lerp(1.0, 0.62, smoothstep(y1 - 0.14 - aaV, y1 - 0.14 + aaV, fy) * (1.0 - tiny));
              float edgeD = min(smoothstep(x0 + 0.08 + aaU, x0 + 0.08 - aaU, fx), 1.0) + (1.0 - smoothstep(x1 - 0.08 - aaU, x1 - 0.08 + aaU, fx));
              albedo *= 1.0 - clamp(edgeD, 0.0, 1.0) * 0.2 * (1.0 - tiny);
              float acR = H.hash12(float2(cellU * 13.7 + wallSeed * 57.0, cellV * 7.9 + cvar * 23.0));
              float acLo = x0 + 0.14, acHi = x1 - 0.14, acTop = y0 + 0.38;
              float3 acTint = ((float3)(1.0));
              acR = H.wlh(cvI + 1667.0, bkv) * 0.45
                  + H.wlh(cvI + 1789.0, H.gmod(floor(cellU / 2.0), 64.0) + H.gmod(cellV, 64.0) * 64.0 + 1.0) * 0.55;
              float acW2 = 0.10 + 0.05 * H.wlh(cvI + 1861.0, bkv);
              float acSide = H.wlh(cvI + 1907.0, bkv) < 0.5 ? -1.0 : 1.0;
              float acCx = lerp(x0 + acW2 + 0.03, x1 - acW2 - 0.03, acSide * 0.5 + 0.5);
              acLo = acCx - acW2; acHi = acCx + acW2;
              acTop = y0 + 0.26 + 0.14 * H.wlh(cvI + 2039.0, bkv);
              float acT = H.wlh(cvI + 2113.0, bkv);
              acTint = acT < 0.5 ? float3(1.04, 1.03, 1.0) : acT < 0.78 ? float3(0.94, 0.92, 0.84) : float3(0.66, 0.67, 0.70);
              if (acR < 0.26 && (style < 2.5 || sidingS) && v > (sidingS ? 3.2 : 6.0)) {
                float acM = smoothstep(y0 + 0.02, y0 + 0.06, fy) * (1.0 - smoothstep(acTop - 0.04, acTop, fy))
                          * smoothstep(acLo, acLo + 0.04, fx) * (1.0 - smoothstep(acHi - 0.04, acHi, fx));
                acM *= winMask * (1.0 - tiny) * smoothstep(0.24, 0.07, aaU);
                float3 acCol = float3(0.60, 0.61, 0.60) * acTint * (0.82 + 0.26 * sin(fy * 92.0));
                albedo = lerp(albedo, acCol, acM);
                UE_gm *= 1.0 - acM;
                FAC_emis *= 1.0 - acM * 0.9;
                FAC_rough = lerp(FAC_rough, 0.55, acM);
              }
            }
            albedo = lerp(diffuseColor.rgb * 0.92, albedo, winMask);
            FAC_emis *= winMask;
            UE_gm *= winMask;
            FAC_rough = lerp(0.9, FAC_rough, winMask);
          } else {
            FAC_dbg = 0.0;
            float tone = H.fbm(float2(u, v) * 0.03 + cvar * 7.0) * 0.2 - 0.1;
            float mottle = H.vnoise(float2(u, v) * 0.7 + cvar * 31.0) * 0.14 - 0.07;
            albedo *= 1.0 + tone + mottle;
            float stain = smoothstep(0.55, 0.9, H.fbm(float2(u * 0.045, v * 0.11) + cvar * 13.0));
            albedo *= 1.0 - stain * 0.16;
            albedo *= 1.0 - smoothstep(3.4, 0.0, v) * (0.1 + 0.16 * H.vnoise(float2(u * 0.5, v * 0.8) + cvar * 19.0));
            albedo *= 1.0 - smoothstep(bldgH - 2.5, bldgH, v) * 0.1;
            FAC_rough = 0.9;
            {
              float gDot = abs(dot(normalize(vViewPosition), normalize(vNormal)));
              FAC_rough -= 0.22 * pow(1.0 - gDot, 4.0);
            }
            if (!glassStyle) {
              {
                float2 wuv = float2(u, v);
                float3 wallT, wallM;
                if (style < 0.5 || (style > 6.5 && style < 7.5) || (style > 11.5 && style < 13.5)) {
                  wallT = Texture2DSample(TwA, TwASampler, wuv * (1.0 / 2.6)).rgb; wallM = float3(0.126, 0.048, 0.017);
                } else if (style < 1.5) {
                  wallT = Texture2DSample(TwB, TwBSampler, wuv * (1.0 / 2.4)).rgb; wallM = float3(0.500, 0.308, 0.158);
                } else if (style < 2.5) {
                  wallT = Texture2DSample(TwC, TwCSampler, wuv * (1.0 / 2.4)).rgb; wallM = float3(0.304, 0.253, 0.184);
                } else if ((style > 3.5 && style < 5.5) || (style > 7.5 && style < 9.5)) {
                  wallT = Texture2DSample(TwS, TwSSampler, wuv * (1.0 / 3.4)).rgb; wallM = float3(0.571, 0.386, 0.221);
                } else if ((style > 5.5 && style < 6.5) || (style > 9.5 && style < 10.5)) {
                  wallT = Texture2DSample(TwP, TwPSampler, wuv * (1.0 / 3.0)).rgb; wallM = float3(0.057, 0.063, 0.072);
                } else { wallT = ((float3)(0.5)); wallM = ((float3)(0.5)); }
                float3 wRat = wallT / max(wallM, ((float3)(0.01)));
                float wLum = dot(wRat, float3(0.2126, 0.7152, 0.0722));
                float wLumC = pow(clamp(wLum, 0.55, 1.7), 0.42);
                bool wStone = (style > 3.5 && style < 5.5) || (style > 7.5 && style < 9.5)
                            || (style > 5.5 && style < 6.5) || (style > 9.5 && style < 10.5);
                float3 wHue = clamp(wRat / max(wLum, 0.05), 0.86, 1.16);
                float3 wRatC = wLumC * lerp(((float3)(1.0)), wHue, wStone ? 0.0 : 0.30);
                float wFp = max(H.fwk(u), H.fwk(v));
                float wStr = lerp(0.36, 0.05, smoothstep(0.008, 0.06, wFp));
                FAC_grainV = lerp(((float3)(1.0)), wRatC, wStr);
                float wBlotch = H.fbm(float2(u, v) * 0.27 + cvar * 23.0);
                albedo *= 0.93 + 0.14 * wBlotch;
              }
              bool brickish = style < 2.5 || (style > 4.5 && style < 5.5) || (style > 6.5 && style < 8.5) || (style > 11.5 && style < 13.5);
              if (brickish) {
                float row = v / 0.3;
                float colB = u / 0.62 + step(0.5, frac(row * 0.5)) * 0.5;
                float2 bc = float2(frac(colB), frac(row));
                float aaBu = H.fwk(colB), aaBv = H.fwk(row);
                float brickVis = smoothstep(0.55, 0.22, max(aaBu, aaBv));
                if (brickVis > 0.003) {
                  float joint = 1.0 - (smoothstep(0.0, 0.045 + aaBu * 1.6, bc.x) * smoothstep(0.0, 0.045 + aaBu * 1.6, 1.0 - bc.x)
                                     * smoothstep(0.0, 0.09 + aaBv * 1.6, bc.y) * smoothstep(0.0, 0.09 + aaBv * 1.6, 1.0 - bc.y));
                  float brickRnd = H.hash12(float2(floor(colB) * 3.1, floor(row) * 7.7) + cvar * 13.0);
                  albedo *= 1.0 + (brickRnd - 0.5) * 0.05 * brickVis;
                  float jointMean = 0.16;
                  albedo = lerp(albedo, albedo * 0.62, lerp(jointMean, joint, brickVis) * 0.4);
                  FAC_rough += joint * 0.1 * brickVis;
                  FAC_nrmAdj += float3(ddx(joint), -ddy(joint), 0.0) * -0.5 * brickVis;
                } else {
                  albedo = lerp(albedo, albedo * 0.62, 0.16 * 0.85);
                }
              } else {
                bool ashlar = (style > 3.5 && style < 5.5) || (style > 7.5 && style < 9.5);
                float crs = v / 0.66;
                float aaCr = max(H.fwk(crs), 1e-4);
                float crVis = ashlar ? smoothstep(0.80, 0.10, aaCr) : 0.0;
                if (crVis > 0.004) {
                  float crJ = 1.0 - H.pcov(crs, 0.05, 0.985, aaCr * 1.25);
                  float blk = u / 1.32 + step(0.5, frac(crs * 0.5)) * 0.5;
                  float aaBk = max(H.fwk(blk), 1e-4);
                  float bkJ = 1.0 - H.pcov(blk, 0.035, 0.99, aaBk * 1.25);
                  float joint = clamp(crJ + bkJ * 0.75, 0.0, 1.0);
                  float bTone = H.hash12(float2(floor(blk) * 2.7, floor(crs) * 5.3) + cvar * 17.0);
                  albedo *= 1.0 + (bTone - 0.5) * 0.07 * crVis;
                  albedo *= 1.0 - joint * 0.19 * crVis;
                  FAC_nrmAdj += float3(ddx(joint), -ddy(joint), 0.0) * -0.42 * crVis;
                  FAC_rough = min(FAC_rough + joint * 0.05 * crVis, 0.98);
                }
                if (bldgH > 26.0 && inBay) {
                  float pv2 = (u - sideM) / winW;
                  float aaP2 = max(H.fwk(pv2), 1e-4);
                  float pierM = 1.0 - H.pcov(pv2, xb0 - 0.06, xb1 + 0.06, aaP2 * 1.25);
                  float pVis = smoothstep(0.85, 0.16, aaP2);
                  FAC_nrmAdj += float3(-ddx(pierM), 0.0, 0.0) * 0.55 * pVis;
                  albedo *= 1.0 + pierM * 0.035 * pVis;
                }
              }
              if (sidingS) {
                float aaUm = max(H.fwk(u), 1e-4);
                float expR = H.hash12(float2(floor(cvar * 191.0), 3.17));
                float expo = expR < 0.34 ? 0.102 : expR < 0.60 ? 0.127 : expR < 0.78 ? 0.114
                           : expR < 0.86 ? 0.089 : expR < 0.95 ? 0.152 : 0.203;
                float crsS = v / expo;
                float aaCs = max(H.fwk(crsS), 1e-4);
                float lapVis = smoothstep(0.75, 0.16, aaCs);
                float fcS = frac(crsS);
                float butt = 1.0 - H.pcov(crsS, 0.0, 0.945, aaCs * 1.25);
                float lip = H.pcov(crsS, 0.0, 0.10, aaCs * 1.25);
                float face = 1.0 - fcS;
                albedo *= lerp(1.0, (1.0 - butt * 0.32) * (0.960 + face * 0.066) * (1.0 + lip * 0.055), lapVis);
                FAC_nrmAdj += float3(ddx(butt), -ddy(butt), 0.0) * -0.70 * lapVis;
                float cIdx = floor(crsS);
                float k6 = H.gmod(cIdx + floor(H.hash12(float2(floor(cvar * 71.0), 11.3)) * 6.0), 6.0);
                float offS = k6 < 0.5 ? 0.0 : k6 < 1.5 ? 1.22 : k6 < 2.5 ? 2.44
                           : k6 < 3.5 ? 0.61 : k6 < 4.5 ? 1.83 : 3.05;
                float runS = (u + offS) / 3.66;
                float aaRs = max(H.fwk(runS), 1e-4);
                float seamS = (1.0 - H.pcov(runS, 0.0016, 1.0, aaRs * 1.25)) * smoothstep(0.40, 0.09, aaRs) * lapVis;
                albedo *= 1.0 - seamS * 0.12;
                float waveS = sin((u + cvar * 37.0) * 4.6) * sin((u * 0.37 + cvar * 11.0));
                FAC_nrmAdj += float3(ddx(waveS), -ddy(waveS), 0.0) * 0.30 * smoothstep(0.10, 0.02, aaUm);
                float chalkA = 0.05 + 0.13 * H.hash12(float2(floor(cvar * 233.0), 17.3));
                float chalk = smoothstep(1.5, 11.0, v) * chalkA * (1.0 - smoothstep(bldgH - 1.6, bldgH - 0.6, v) * 0.7);
                albedo = lerp(albedo, albedo * 0.80 + float3(0.155, 0.153, 0.146), chalk);
                FAC_rough = expo > 0.14 ? 0.52 : 0.66;
                float trimR = H.hash12(float2(floor(cvar * 149.0), 5.9));
                float3 trimC = trimR < 0.72 ? float3(0.585, 0.578, 0.552)
                           : trimR < 0.88 ? float3(0.545, 0.505, 0.400)
                           : diffuseColor.rgb * 1.10;
                float dEndS = min(u, wallLen - u);
                float postM = smoothstep(0.082 + aaUm, 0.082 - aaUm, dEndS) * smoothstep(0.22, 0.05, aaUm);
                albedo = lerp(albedo, trimC, postM * 0.90);
                FAC_rough = lerp(FAC_rough, 0.45, postM);
                if (inBay) {
                  float du0 = (x0 - fx) * winW, du1 = (fx - x1) * winW;
                  float dv0 = (y0 - fy) * floorH, dv1 = (fy - y1) * floorH;
                  float dOut = max(max(du0, du1), max(dv0, dv1));
                  float aaTm = max(H.fwk(dOut), 1e-4);
                  float caseM = smoothstep(-aaTm, aaTm, dOut) * smoothstep(0.072 + aaTm, 0.072 - aaTm, dOut)
                              * smoothstep(0.16, 0.04, aaTm);
                  albedo = lerp(albedo, trimC, caseM * 0.92);
                  FAC_rough = lerp(FAC_rough, 0.42, caseM);
                }
              }
              if (condoS) {
                float panW = 1.15 + 0.45 * H.hash12(float2(floor(cvar * 173.0), 9.1));
                float pnU = u / panW;
                float aaPn = max(H.fwk(pnU), 1e-4);
                float pnVis = smoothstep(0.55, 0.14, aaPn);
                float jV = (1.0 - H.pcov(pnU, 0.010, 1.0, aaPn * 1.25)) * pnVis;
                float rowC = v / floorH;
                float aaRc = max(H.fwk(rowC), 1e-4);
                float jH = (1.0 - H.pcov(rowC, 0.012, 1.0, aaRc * 1.25)) * smoothstep(0.55, 0.14, aaRc);
                float pnTint = H.hash12(float2(floor(pnU) * 3.7, floor(rowC) * 6.1 + cvar * 43.0));
                albedo *= 1.0 + (pnTint - 0.5) * 0.055 * pnVis;
                albedo *= 1.0 - clamp(jV + jH * 0.85, 0.0, 1.0) * 0.30;
                FAC_nrmAdj += float3(ddx(jV + jH), -ddy(jV + jH), 0.0) * -0.45;
                float rcVis = smoothstep(0.55, 0.14, aaRc);
                float spF = frac(rowC);
                float spM = smoothstep(y1 - 0.02, y1 + 0.05, spF) * (1.0 - smoothstep(0.985, 1.0, spF)) * rcVis;
                albedo *= 1.0 - spM * 0.14;
                float slab = smoothstep(0.0, 0.055, spF) * (1.0 - smoothstep(0.075, 0.13, spF)) * rcVis;
                albedo = lerp(albedo, float3(0.44, 0.435, 0.415), slab * 0.55);
                albedo *= 1.0 - smoothstep(0.075, 0.13, spF) * (1.0 - smoothstep(0.13, 0.20, spF)) * rcVis * 0.22;
                FAC_rough = 0.58;
              }
              if (inBay && bldgH > 6.0 && tiny < 0.9) {
                float belowS = (y0 - fy) * floorH;
                if (belowS > 0.0) {
                  float sNw = 0.4 + 0.6 * H.vnoise(float2(u * 2.7, cellV * 5.0 + cvar * 11.0));
                  float sProf = smoothstep(x0 - 0.04, x0 + 0.16, fx) * smoothstep(x1 + 0.04, x1 - 0.16, fx);
                  albedo *= 1.0 - sProf * smoothstep(1.15, 0.02, belowS) * sNw * 0.2 * (1.0 - tiny);
                }
              }
              {
                float dTopW = bldgH - 1.95 - v;
                if (dTopW > -0.2 && dTopW < 1.6) {
                  float limeN = smoothstep(0.6, 0.95, H.vnoise(float2(u * 2.9, cvar * 47.0)));
                  float lime = limeN * smoothstep(-0.1, 0.12, dTopW) * smoothstep(1.5, 0.25, dTopW);
                  albedo = lerp(albedo, albedo * 1.3 + ((float3)(0.05)), lime * 0.45);
                }
              }
              {
                float dEndW = min(u, wallLen - u);
                float eNw = 0.55 + 0.45 * H.vnoise(float2(v * 0.6, wallSeed * 31.0));
                albedo *= 1.0 - smoothstep(0.85, 0.04, dEndW) * eNw * 0.13;
              }
              {
                float sootN = 0.55 + 0.45 * H.fbm(float2(u * 0.33, v * 0.12) + cvar * 37.0);
                albedo *= 1.0 - smoothstep(14.0, 0.0, v) * sootN * 0.17;
                float dTopG = bldgH - v;
                float parN = 0.4 + 0.6 * H.vnoise(float2(u * 1.7, cvar * 19.0));
                albedo *= 1.0 - smoothstep(2.3, 0.4, dTopG) * smoothstep(-0.1, 0.3, dTopG) * parN * 0.2;
                if (store && storeH > 1.0) {
                  float dS = v - storeH;
                  float sN = 0.45 + 0.55 * H.vnoise(float2(u * 2.1 + cvar * 53.0, v * 0.9));
                  albedo *= 1.0 - smoothstep(2.4, 0.0, dS) * step(0.0, dS) * sN * 0.16;
                }
              }
              {
                float cN = 0.45 + 0.55 * H.fbm(float2(u * 0.7, v * 1.1) + cvar * 71.0);
                float splash = smoothstep(1.35, 0.02, v) * cN;
                albedo *= 1.0 - splash * 0.26;
                float bloomN = smoothstep(0.55, 0.93, H.vnoise(float2(u * 1.25 + cvar * 23.0, v * 2.2)));
                float bloom = bloomN * smoothstep(1.05, 0.12, v) * smoothstep(0.02, 0.22, v) * (1.0 - tiny);
                albedo = lerp(albedo, albedo * 0.55 + float3(0.125, 0.121, 0.112), bloom * 0.5);
                FAC_rough = min(0.99, FAC_rough + bloom * 0.06);
                albedo *= 1.0 - smoothstep(0.16, 0.0, v) * 0.34;
              }
              if (inBay && tiny < 0.9 && bldgH > 6.0) {
                float belowE = (y0 - fy) * floorH;
                if (belowE > -0.04 && belowE < 1.5) {
                  float endP = smoothstep(0.20, 0.05, abs(fx - x0 - 0.055)) + smoothstep(0.20, 0.05, abs(fx - x1 + 0.055));
                  float dripN = 0.35 + 0.65 * H.vnoise(float2(u * 3.9, cellV * 7.0 + cvar * 13.0));
                  albedo *= 1.0 - clamp(endP, 0.0, 1.0) * smoothstep(1.45, 0.0, belowE) * dripN * 0.26;
                  float lipM = smoothstep(-0.02, 0.01, belowE) * smoothstep(0.11, 0.02, belowE)
                             * smoothstep(x0 - 0.09, x0 + 0.02, fx) * smoothstep(x1 + 0.09, x1 - 0.02, fx);
                  albedo *= 1.0 - lipM * 0.30 * smoothstep(0.050, 0.015, aaV);
                }
                bool resiW = style < 2.5 || (style > 4.5 && style < 5.5) || style > 11.5;
                if (resiW && v > 3.0 && belowE > 0.0) {
                  float acR = H.hash12(float2(cellUS * 13.3, cellV * 5.9 + cvar * 29.0));
                  if (acR < 0.17) {
                    float acX = x0 + 0.20 + 0.34 * frac(acR * 37.0);
                    float acW = 0.055 + 0.035 * frac(acR * 91.0);
                    float rustP = smoothstep(acW + 0.05, acW - 0.03, abs(fx - acX));
                    float rustN = 0.4 + 0.6 * H.vnoise(float2(u * 6.0 + cvar * 7.0, v * 1.6));
                    float rust = rustP * smoothstep(1.45, 0.0, belowE) * rustN * smoothstep(0.15, 0.045, aaU);
                    albedo = lerp(albedo, albedo * float3(0.86, 0.52, 0.34), rust * 0.62);
                  }
                }
              }
              {
                float pnl = H.hash12(float2(floor(cuC / 2.0) + wallSeed * 19.0, floor(v / (floorH * 2.0)) * 1.7 + cvar * 29.0));
                albedo *= 0.88 + 0.24 * pnl;
                float pHue = H.hash12(float2(floor(cuC / 2.0) * 5.3 + cvar * 61.0, floor(v / (floorH * 2.0)) + wallSeed * 7.0));
                albedo *= lerp(((float3)(1.0)), float3(1.11, 0.93, 0.86), smoothstep(0.74, 0.98, pHue) * 0.20);
                float big = H.hash12(float2(floor(cuC / 6.0) * 2.9 + wallSeed * 31.0, floor(v / 12.0) * 3.3 + cvar * 17.0));
                albedo *= 0.93 + 0.14 * big;
              }
              {
                float bEdge = min(fx, 1.0 - fx);
                float dripN = 0.5 + 0.5 * H.vnoise(float2(cellU * 7.7 + wallSeed * 23.0, v * 0.1));
                albedo *= 1.0 - smoothstep(0.16, 0.02, bEdge) * dripN * 0.1 * (1.0 - tiny);
              }
              float streak = H.fbm(float2(u * 0.11, v * 0.06) + cvar * 3.0);
              albedo *= 1.0 - smoothstep(0.25, 0.8, streak) * 0.18;
              float six = frac(v / (floorH * 6.0));
              if (six > 0.985 || six < 0.012) albedo *= 1.14;
              if (fy < 0.1) albedo *= 0.93;
              if (fy > y1 && fy < y1 + 0.07) albedo *= 0.75;
              if (fy > y0 - 0.06 && fy < y0) albedo *= 1.1;
              if (wlBrick > 0.002) {
                float bTone2 = H.wlh(cvI + 509.0, bkv);
                float3 fillC = bTone2 < 0.34 ? float3(0.42, 0.41, 0.39) : lerp(float3(0.34, 0.25, 0.21), float3(0.46, 0.37, 0.31), bTone2);
                fillC *= 0.86 + 0.22 * H.vnoise(float2(u * 1.7, v * 2.3) + cvI * 0.031);
                float ic = (v + 0.031 * (1.0 + bTone2)) / 0.082;
                float aaIc = max(H.fwk(ic), 1e-4);
                float icJ = 1.0 - H.pcov(ic, 0.10, 0.97, aaIc * 1.25);
                float ib = u / 0.21 + step(0.5, frac(ic * 0.5)) * 0.5;
                float aaIb = max(H.fwk(ib), 1e-4);
                float ibJ = 1.0 - H.pcov(ib, 0.06, 0.98, aaIb * 1.25);
                float icVis = smoothstep(0.9, 0.15, aaIc);
                fillC *= 1.0 - clamp(icJ + ibJ * 0.7, 0.0, 1.0) * 0.16 * icVis;
                float rvT = smoothstep(y1, y1 - 0.10, fy);
                float rvL = smoothstep(x0, x0 + 0.06, fx) * smoothstep(x1, x1 - 0.06, fx);
                fillC *= lerp(0.62, 1.0, rvT) * lerp(0.78, 1.0, rvL);
                fillC *= 1.0 - smoothstep(0.55, 0.0, (fy - y0) / max(y1 - y0, 0.01)) * 0.10;
                albedo = lerp(albedo, fillC, wlBrick * (1.0 - tiny));
                FAC_rough = lerp(FAC_rough, 0.95, wlBrick * (1.0 - tiny));
              }
              if (loftStyle && (fx < 0.06 || fx > 0.94)) albedo *= 1.12;
              if (!loftStyle && style < 9.5 && bldgH > 8.0 && wallLen > 4.0 && v < bldgH - 1.2) {
                float courseQ = floor(v / 0.6);
                float wQ = 0.55 * (H.gmod(courseQ, 2.0) > 0.5 ? 1.0 : 0.66);
                float dEnd = min(u, wallLen - u);
                float aaQ = max(H.fwk(u), 1e-4);
                float qVis = smoothstep(0.5, 0.2, H.fwk(v) / 0.6) * (1.0 - tiny);
                float qM = smoothstep(wQ + aaQ, wQ - aaQ, dEnd) * qVis;
                if (qM > 0.003) {
                  float jvQ = frac(v / 0.6);
                  float aaJv = H.fwk(v) / 0.6;
                  float qJoint = 1.0 - smoothstep(0.0, 0.07 + aaJv * 1.5, jvQ) * smoothstep(0.0, 0.07 + aaJv * 1.5, 1.0 - jvQ);
                  float qTint = 0.9 + 0.2 * H.hash12(float2(courseQ * 3.7, wallSeed * 91.0));
                  float3 qCol = float3(0.585, 0.565, 0.525) * qTint * (1.0 - qJoint * 0.35);
                  albedo = lerp(albedo, qCol, qM * 0.85);
                  FAC_rough = lerp(FAC_rough, 0.72, qM * 0.6);
                  FAC_nrmAdj += float3(ddx(qM * (1.0 - qJoint)), -ddy(qM * (1.0 - qJoint)), 0.0) * 0.3 * qVis;
                }
              }
              bool stoneD = (style > 0.5 && style < 2.5) || (style > 3.5 && style < 5.5) || (style > 7.5 && style < 9.5);
              if (stoneD && inBay && !(doorWall && cellU == doorCell && v < 3.6) && tiny < 0.7) {
                float aaFy = max(H.fwk(fy), 1e-4);
                float kW = 0.05 + max(fy - y1, 0.0) * 0.35;
                float keyM = smoothstep(y1 - aaFy, y1 + 0.02, fy) * (1.0 - smoothstep(y1 + 0.14, y1 + 0.16 + aaFy, fy))
                           * smoothstep(kW + aaU, kW - aaU, abs(fx - 0.5)) * (1.0 - tiny);
                float lumW = dot(diffuseColor.rgb, float3(0.4, 0.45, 0.15));
                float3 keyC = float3(1.03, 1.0, 0.93) * (0.40 + lumW * 0.38) * (0.94 + 0.12 * H.hash12(float2(cellUS * 9.1, cvar * 61.0)));
                albedo = lerp(albedo, keyC, keyM * 0.92);
                float bM = clamp(smoothstep(0.035 + aaU, 0.035 - aaU, abs(fx - x0 - 0.09)) + smoothstep(0.035 + aaU, 0.035 - aaU, abs(fx - x1 + 0.09)), 0.0, 1.0)
                         * smoothstep(y0 - 0.16, y0 - 0.13 + aaFy, fy) * (1.0 - smoothstep(y0 - 0.075, y0 - 0.06 + aaFy, fy)) * (1.0 - tiny);
                albedo = lerp(albedo, albedo * float3(0.58, 0.56, 0.55), bM * 0.85);
                FAC_nrmAdj += float3(ddx(keyM - bM), -ddy(keyM - bM), 0.0) * 0.22 * (1.0 - tiny);
              }
            } else { albedo = diffuseColor.rgb * 0.55; FAC_rough = 0.4; }
            if (v < 4.5 && !store && style < 9.0 && bldgH > 20.0) {
              float aaWv = max(H.fwk(v), 1e-4);
              float crs = v / 0.56;
              float crsVis = smoothstep(0.55, 0.22, H.fwk(crs));
              float cJ = 1.0 - H.pcov(crs, 0.055, 0.97, max(H.fwk(crs), 1e-4) * 1.25);
              float cId = floor(crs);
              float bTint = 1.0 + (H.hash12(float2(cId * 3.3, wallSeed * 71.0)) - 0.5) * 0.16 * crsVis;
              float blk = u / 1.15 + H.gmod(cId, 2.0) * 0.5;
              float bJ = (1.0 - H.pcov(blk, 0.03, 0.985, max(H.fwk(blk), 1e-4) * 1.25)) * crsVis;
              float3 baseC = float3(0.70, 0.67, 0.60) * bTint;
              baseC *= 1.0 - max(cJ, bJ * 0.7) * 0.36;
              baseC *= 1.0 - smoothstep(0.55, 0.0, v) * 0.22;
              baseC *= 1.0 - smoothstep(4.50, 4.38, v) * smoothstep(4.28, 4.40, v) * 0.30;
              baseC *= 1.0 - smoothstep(0.85, 0.05, v) * (0.30 + 0.30 * H.vnoise(float2(u * 0.9 + cvar * 17.0, v * 1.7)));
              baseC = lerp(baseC, baseC * 0.6 + float3(0.16, 0.155, 0.145),
                          smoothstep(0.58, 0.92, H.vnoise(float2(u * 1.6 + cvar * 31.0, v * 2.4))) * smoothstep(0.9, 0.1, v) * 0.45);
              float bandM = smoothstep(4.5 + aaWv, 4.5 - aaWv, v) * (1.0 - tiny);
              albedo = lerp(albedo, baseC, 0.72 * bandM);
              FAC_rough = lerp(FAC_rough, 0.7, bandM);
              FAC_nrmAdj += float3(ddx(-cJ * bandM), -ddy(-cJ * bandM), 0.0) * 0.3 * crsVis;
            }
            if (doorWall && cellU == doorCell && v < 3.6 && tiny < 0.8) {
              float aaM = max(H.fwk(v), 1e-3);
              float caseM = H.pcov(cuC, 0.5 - 0.36, 0.5 + 0.36, aaU * 1.25) * smoothstep(2.95 + aaM, 2.86 - aaM, v);
              float doorM = H.pcov(cuC, 0.5 - 0.28, 0.5 + 0.28, aaU * 1.25) * smoothstep(2.72 + aaM, 2.63 - aaM, v);
              albedo = lerp(albedo, float3(0.58, 0.56, 0.51), caseM * 0.9);
              if (doorM > 0.003) {
                float dfx = clamp((fx - 0.5) / 0.28, -1.0, 1.0);
                float3 dCol = doorColI < 0.5 ? float3(0.16, 0.11, 0.08)
                          : doorColI < 1.5 ? float3(0.26, 0.09, 0.08)
                          : doorColI < 2.5 ? float3(0.09, 0.14, 0.12)
                          : float3(0.12, 0.12, 0.14);
                float3 slab = dCol * (0.72 + 0.28 * smoothstep(1.0, 0.55, abs(dfx)));
                float panel = smoothstep(0.12, 0.2, abs(dfx)) * (1.0 - smoothstep(0.72, 0.8, abs(dfx)))
                            * smoothstep(0.3, 0.42, v) * (1.0 - smoothstep(2.2, 2.32, v));
                slab *= 1.0 - panel * 0.22;
                if (v < 0.28) slab = float3(0.32, 0.33, 0.34);
                if (v > 2.32 && v < 2.63) {
                  slab = float3(0.07, 0.09, 0.1);
                  FAC_emis += float3(1.0, 0.8, 0.5) * night * 0.5 * doorM;
                }
                albedo = lerp(albedo, slab, doorM);
                FAC_rough = lerp(FAC_rough, 0.45, doorM);
              }
              float dl = length(float2((fx - 0.5) * winW, v - 2.98));
              float lampD = smoothstep(0.15, 0.06, dl);
              albedo = lerp(albedo, float3(0.2, 0.19, 0.17), lampD);
              FAC_emis += float3(1.0, 0.72, 0.4) * night * lampD * 2.4;
            }
          }
          {
            float towerF = smoothstep(34.0, 60.0, bldgH);
            if (towerF > 0.01) {
              float fl = v / max(floorH, 2.0);
              float aaF = max(H.fwk(fl), 1e-4);
              float bandVis = smoothstep(0.85, 0.22, aaF) * towerF;
              if (glassStyle) {
                float sp = 1.0 - H.pcov(fl, 0.30, 0.97, aaF * 1.25);
                float3 spC = diffuseColor.rgb * (0.40 + 0.20 * H.hash12(float2(floor(cvar * 199.0), 5.71)));
                albedo = lerp(albedo, spC, sp * bandVis * 0.80);
                FAC_rough = lerp(FAC_rough, 0.34, sp * bandVis * 0.7);
                FAC_emis *= 1.0 - sp * bandVis * 0.85;
                FAC_spand = sp * bandVis;
                UE_gm *= 1.0 - FAC_spand; UE_sp = max(UE_sp, FAC_spand);
              } else if (!store) {
                float sp = 1.0 - H.pcov(fl, yb0, yb1, aaF * 1.25);
                float inCol = H.pcov(cuC, xb0, xb1, aaU * 1.25);
                albedo *= 1.0 - sp * inCol * bandVis * 0.15;
              }
              if (!store) {
                float grp = 3.0 + step(0.5, H.hash12(float2(floor(cvar * 173.0), 11.9)));
                float pc = cuC / grp;
                float aaP = max(H.fwk(pc), 1e-4);
                float pier = 1.0 - H.pcov(pc, 0.10, 0.94, aaP * 1.25);
                albedo *= 1.0 - pier * smoothstep(0.9, 0.25, aaP) * towerF * (glassStyle ? 0.17 : 0.11);
              }
              if (!glassStyle) {
                float fam = famR;
                float3 tint = fam < 0.34 ? float3(1.06, 0.99, 0.86)
                          : fam < 0.58 ? float3(1.04, 0.92, 0.80)
                          : fam < 0.80 ? float3(0.95, 0.94, 0.92)
                          : float3(1.0, 0.94, 0.90);
                float val = 0.78 + 0.36 * H.hash12(float2(cvar * 419.0, 13.31));
                albedo *= lerp(((float3)(1.0)), tint * val, towerF * 0.7);
                albedo *= lerp(1.0, 0.86, tiny * towerF);
              }
              if (night > 0.01) {
                float fl2 = floor(v / max(floorH, 2.0));
                float fLit = H.hash12(float2(fl2 * 3.71 + cvar * 61.0, 1.93));
                float whole = step(0.86, fLit);
                float darkF = step(fLit, 0.34);
                FAC_emis *= lerp(1.0, lerp(1.0, 2.5, whole) * lerp(1.0, 0.28, darkF), night * towerF);
              }
            }
            float cwF = smoothstep(18.0, 30.0, bldgH);
            if (fGlass && cwF > 0.01 && !isRoof && !blind) {
              float dBase = max(dot(diffuseColor.rgb, ((float3)(0.3333))), 1e-3);
              float pat = clamp(dot(albedo, ((float3)(0.3333))) / dBase, 0.18, 2.0);
              albedo = lerp(albedo, famAlb * pat, 0.94 * cwF);
              float3 Vw2 = normalize(cameraPosition - vWP);
              float3 Nw2 = normalize(cross(ddx(vWP), -ddy(vWP)));
              if (dot(Nw2, Vw2) < 0.0) Nw2 = -Nw2;
              Nw2 = normalize(Nw2 + float3(H.hash12(float2(cvar * 311.0, 2.13)) - 0.5, 0.0,
                                         H.hash12(float2(7.31, cvar * 431.0)) - 0.5) * 0.030);
              float3 Rw2 = reflect(-Vw2, Nw2);
              float cosT = max(dot(Vw2, Nw2), 0.0);
              float F = H.fresnelR(cosT, FAC_glassF.x);
              float fpW = length(H.fwk(vWP)) * 0.06;
              float kR = cwF * (0.72 + 0.56 * H.hash12(float2(floor(cvar * 89.0), 21.7)))
                       * (1.0 - 0.62 * FAC_spand);
              float canyonF = lerp(0.42, 1.0, smoothstep(6.0, 52.0, v));
              FAC_emis += H.skyLook(Rw2, sunDirW, sunColW, uZenC, uHorC, uRefl, FAC_glassF.z)
                        * FAC_reflTint * F * kR * canyonF;
              FAC_emis += sunColW * FAC_reflTint
                        * H.sunDisc(Rw2, sunDirW, FAC_glassF.y, fpW)
                        * F * 20.0 * uRefl * kR * (1.0 - night);
              FAC_rough = min(FAC_rough, lerp(0.9, FAC_glassF.y, kR));
              UE_glass = max(UE_glass, kR); UE_f0 = FAC_glassF.x;
              if (!inWin) UE_gm = max(UE_gm, 0.8 * cwF * (1.0 - FAC_spand) * smoothstep(0.5, 0.9, tiny));   // (FP18: a far curtain wall, its grid below a pixel)
            }
          }
          if (cornice && sidingS) {
            float cFas = 0.40;
            if (v > bldgH - cFas && v < bldgH) { albedo = lerp(albedo, float3(0.555, 0.548, 0.522), 0.75); FAC_rough = 0.45; FAC_nrmAdj = float3(0.0, 0.22, 0.0); }
            else if (v > bldgH - cFas - 0.22 && v <= bldgH - cFas) albedo *= 0.52;
          } else
          if (cornice && v > bldgH - 1.15 && v < bldgH) { albedo *= 0.6; FAC_nrmAdj = float3(0.0, 0.25, 0.0); }
          if (cornice && !sidingS && v > bldgH - 1.85 && v < bldgH - 1.15) albedo *= 0.85;
          albedo *= 1.0 - 0.24 * (1.0 - smoothstep(0.0, 9.0, v));
          {
            float tqW = tq32On * (1.0 - smoothstep(tq32C.z, tq32C.w, length(vWP.xz - tq32C.xy)));
            float tqHero = smoothstep(240.0, 300.0, length(vWP - cameraPosition));
            bool tqDeco = style > 3.5 && style < 4.5;
            if (tqW > 0.002 && bldgH > 20.0 && (glassStyle || (tqDeco && tqHero > 0.001)) && inBay && bayN >= 2.0
                && !(store && v < storeH + 0.25) && v > 0.6 && v < bldgH - 1.0) {
              float tqWr = glassStyle ? tqW : tqW * tqHero;
              float tqH1 = H.hash12(float2(floor(cvar * 263.0), 41.3));
              float tqH2 = H.hash12(float2(floor(cvar * 157.0), 7.9));
              float finD = glassStyle ? lerp(0.08, 0.40, tqH1 * tqH1) : lerp(0.24, 0.40, tqH1);
              float finHW = glassStyle ? max(0.045 * winW, 0.055) : max((xb0 - 0.03) * winW, 0.22);
              float grp = 3.0 + step(0.5, H.hash12(float2(floor(cvar * 173.0), 11.9)));
              float kL = floor(cuC);
              float bigL = glassStyle ? 1.0 - step(0.5, H.gmod(kL, grp)) : 0.0;
              float bigR = glassStyle ? 1.0 - step(0.5, H.gmod(kL + 1.0, grp)) : 0.0;
              float g0 = finHW * lerp(1.0, 2.3, bigL) / winW;
              float g1 = 1.0 - finHW * lerp(1.0, 2.3, bigR) / winW;
              float fr = cuC - kL;
              float3 tqN = normalize(vNormal);
              float3 tqUp = normalize(H.V3(float3(0.0, 1.0, 0.0)));
              float3 tqT = normalize(cross(tqN, tqUp));
              float3 tqB = normalize(cross(tqN, tqT)); if (dot(tqB, tqUp) < 0.0) tqB = -tqB;
              float3 tqR = normalize(-vViewPosition);
              float tqRz = max(dot(tqR, -tqN), 0.03);
              float tx = dot(tqR, tqT) / tqRz / winW;
              float ty = dot(tqR, tqB) / tqRz / floorH;
              float aaB = max(aaU, 1e-4);
              float inGap = smoothstep(g0 - aaB, g0 + aaB, fr) * (1.0 - smoothstep(g1 - aaB, g1 + aaB, fr));
              float frD = fr + tx * finD;
              float overH = tx > 0.0 ? frD - g1 : g0 - frD;
              float sideH = smoothstep(-aaB, aaB, overH);
              float sH = clamp(tx > 0.0 ? (g1 - fr) / max(tx, 1e-5) : (fr - g0) / max(-tx, 1e-5), 0.0, finD);
              float3 nSH = tx > 0.0 ? -tqT : tqT;
              float capP = finD * 0.55, dLF = finD - capP;
              float hl = glassStyle ? 0.10 / floorH : 0.0;
              float gl = v / floorH - 0.30;
              float frV = gl - floor(gl);
              float aaFl = max(H.fwk(gl), 1e-4);
              float p0 = frV + ty * dLF, p1 = frV + ty * finD;
              float m0 = floor(p0);
              float capF = glassStyle ? 1.0 - smoothstep(hl - aaFl, hl + aaFl, abs(p0 - floor(p0 + 0.5))) : 0.0;
              float overV = ty > 0.0 ? p1 - (m0 + 1.0 - hl) : (m0 + hl) - p1;
              float sideV = glassStyle ? (1.0 - capF) * smoothstep(-aaFl, aaFl, overV) : 0.0;
              float sV = clamp(dLF + (ty > 0.0 ? ((m0 + 1.0 - hl) - p0) / max(ty, 1e-5) : (p0 - (m0 + hl)) / max(-ty, 1e-5)), dLF, finD);
              float3 nSV = ty > 0.0 ? -tqB : tqB;
              float front = 1.0 - inGap;
              float finFirst = sideH * step(sH, dLF);
              float wSH = inGap * finFirst;
              float rem = inGap * (1.0 - finFirst);
              float wCF = rem * capF;
              float rem2 = rem - wCF;
              float wSV = rem2 * sideV * (1.0 - sideH * step(sH, sV));
              wSH += rem2 * sideH * (1.0 - sideV * step(sV, sH));
              float wRec = max(inGap - wSH - wCF - wSV, 0.0);
              float3 tqL = normalize(H.V3(sunDirW));
              float lN = dot(tqL, tqN);
              float lx = dot(tqL, tqT) / max(lN, 0.02) / winW;
              float ly = dot(tqL, tqB) / max(lN, 0.02) / floorH;
              float frS = frD + lx * finD;
              float litX = smoothstep(g0 - aaB, g0 + aaB, frS) * (1.0 - smoothstep(g1 - aaB, g1 + aaB, frS));
              float litY = glassStyle ? 1.0 - smoothstep(-aaFl, aaFl, frac(p1) + max(ly, 0.0) * capP - (1.0 - hl)) : 1.0;
              float litSide = 1.0 - smoothstep(-aaB, aaB, abs(lx) * sH - (g1 - g0));
              float frF = fr + 2.0 * tx * finD;
              float occH = 1.0 - smoothstep(g0 - aaB, g0 + aaB, frF) * (1.0 - smoothstep(g1 - aaB, g1 + aaB, frF));
              float occV = glassStyle ? smoothstep(-aaFl, aaFl, frac(p1) + max(ty, 0.0) * capP - (1.0 - hl)) : 0.0;
              float refOcc = 1.0 - (1.0 - occH) * (1.0 - occV);
              float vis = smoothstep(0.55, 0.2, aaB) * (glassStyle ? smoothstep(0.55, 0.2, aaFl) : 1.0);
              {
                float gW = max(1.0 - 2.0 * finHW / winW * (1.0 + (glassStyle ? 1.3 / grp : 0.0)), 0.05);
                float pH = min(abs(tx) * finD / gW, 1.0);
                float cF = 2.0 * hl, pV = glassStyle ? min(abs(ty) * capP / max(1.0 - cF, 0.05), 1.0) : 0.0;
                float mRest = gW * (1.0 - pH);
                front = lerp(1.0 - gW, front, vis);
                wSH = lerp(gW * pH, wSH, vis);
                wCF = lerp(mRest * cF, wCF, vis);
                wSV = lerp(mRest * (1.0 - cF) * pV, wSV, vis);
                wRec = lerp(mRest * (1.0 - cF) * (1.0 - pV), wRec, vis);
                litX = lerp(clamp(1.0 - abs(lx) * finD / gW, 0.0, 1.0), litX, vis);
                litY = lerp(glassStyle ? clamp(1.0 - max(ly, 0.0) * capP / max(1.0 - cF, 0.05), 0.0, 1.0) : 1.0, litY, vis);
                litSide = lerp(clamp(1.0 - abs(lx) * finD * 0.5 / gW, 0.0, 1.0), litSide, vis);
                refOcc = lerp(clamp(abs(tx) * finD / gW + (glassStyle ? max(ty, 0.0) * capP / max(1.0 - cF, 0.05) : 0.0), 0.0, 1.0), refOcc, vis);
              }
              float3 capC = diffuseColor.rgb * float3(0.95, 0.94, 0.92); float capR = 0.86, capM = 0.0;
              if (glassStyle) {
                if (tqH2 < 0.22) { capC = float3(0.075, 0.077, 0.082); capR = 0.40; capM = 0.40; }
                else if (famR < 0.30) { capC = float3(0.110, 0.085, 0.060); capR = 0.36; capM = 0.55; }
                else if (famR < 0.62) { capC = float3(0.300, 0.310, 0.320); capR = 0.44; capM = 0.40; }
                else if (famR < 0.84) { capC = float3(0.460, 0.470, 0.490); capR = 0.32; capM = 0.60; }
                else { capC = float3(0.300, 0.240, 0.140); capR = 0.34; capM = 0.55; }
                float cv = H.hash12(float2(floor(v / floorH) * 3.1 + cvar * 13.0, kL * 0.37)) - 0.5;
                capC *= 1.0 + cv * 0.10 * vis;
                capC *= 1.0 - 0.18 * smoothstep(0.45, 0.0, frac(v / floorH)) * vis;
              }
              float dFin = min(fr - g0, g1 - fr) * winW;
              float aoR = 1.0 - 0.34 * exp(-max(dFin, 0.0) / (0.35 * finD + 0.05)) * vis - 0.10 * (1.0 - vis);
              float3 recA = albedo * aoR;
              float3 frontA = glassStyle ? capC : albedo;
              float3 sideA = glassStyle ? capC * 0.92 : capC * 0.88;
              float3 nA = frontA * front + capC * wCF + sideA * (wSH + wSV) + recA * wRec;
              float nR = (glassStyle ? capR : FAC_rough) * front + capR * (wCF + wSH + wSV) + FAC_rough * wRec;
              float eK = glassStyle ? wRec * (1.0 - refOcc * 0.5 * (1.0 - night)) : front + wRec;
              float sunK = front + wCF + wSH * (lN > 0.0 ? litSide : 0.0) + wSV * step(0.0, lN) + wRec * litX * litY;
              albedo = lerp(albedo, nA, tqWr);
              FAC_rough = lerp(FAC_rough, nR, tqWr);
              FAC_emis *= lerp(1.0, eK, tqWr);
              FAC_metal = capM * (front + wCF + wSH + wSV) * tqWr;
              FAC_sunK = lerp(1.0, sunK, tqWr);
              FAC_nrmAdj += (nSH * wSH + nSV * wSV) * 4.0 * tqWr;
              if (glassStyle) {
                float3 Vm = normalize(cameraPosition - vWP);
                float3 nFw = normalize(H.W3(tqN));
                float3 nHw = normalize(H.W3(nSH));
                float3 nVw = normalize(H.W3(nSV));
                float3 f0m = lerp(((float3)(0.04)), capC, capM);
                float3 mF = H.skyLook(reflect(-Vm, nFw), sunDirW, sunColW, uZenC, uHorC, uRefl, 1.0) * (f0m + (1.0 - f0m) * pow(1.0 - clamp(dot(Vm, nFw), 0.0, 1.0), 5.0));
                float3 mH = H.skyLook(reflect(-Vm, nHw), sunDirW, sunColW, uZenC, uHorC, uRefl, 1.0) * (f0m + (1.0 - f0m) * pow(1.0 - clamp(dot(Vm, nHw), 0.0, 1.0), 5.0));
                float3 mV = H.skyLook(reflect(-Vm, nVw), sunDirW, sunColW, uZenC, uHorC, uRefl, 1.0) * (f0m + (1.0 - f0m) * pow(1.0 - clamp(dot(Vm, nVw), 0.0, 1.0), 5.0));
                float cnF = lerp(0.42, 1.0, smoothstep(6.0, 52.0, v));
                FAC_emis += (mF * (front + wCF) + mH * wSH + mV * wSV) * cnF * (1.0 - 0.5 * capR) * tqW;
              }
            }
            if (tqW > 0.002 && tqHero > 0.001 && style > 1.5 && style < 2.5 && bldgH > 40.0 && inBay && !(store && v < storeH + 0.25) && v > 0.6 && v < bldgH - 1.0) {
              float bD = lerp(0.18, 0.32, H.hash12(float2(floor(cvar * 199.0), 9.1)));
              float bw = clamp(1.0 + yb0 - yb1, 0.2, 0.7);
              float hv = v / floorH - yb1, fh = hv - floor(hv);
              float aaF = max(H.fwk(hv), 1e-4);
              float3 pN = normalize(vNormal);
              float3 pUp = normalize(H.V3(float3(0.0, 1.0, 0.0)));
              float3 pT = normalize(cross(pN, pUp));
              float3 pB = normalize(cross(pN, pT)); if (dot(pB, pUp) < 0.0) pB = -pB;
              float3 pR = normalize(-vViewPosition);
              float pRz = max(dot(pR, -pN), 0.03);
              float pty = dot(pR, pB) / pRz / floorH;
              float inRow = smoothstep(bw - aaF, bw + aaF, fh) * (1.0 - smoothstep(1.0 - aaF, 1.0, fh));
              float fhD = fh + pty * bD;
              float over = pty > 0.0 ? fhD - 1.0 : bw - fhD;
              float sideB = inRow * smoothstep(-aaF, aaF, over);
              float wRow = inRow - sideB;
              float3 pL = normalize(H.V3(sunDirW));
              float plN = dot(pL, pN);
              float ply = dot(pL, pB) / max(plN, 0.02) / floorH;
              float litB = 1.0 - smoothstep(1.0 - aaF, 1.0 + aaF, fhD + max(ply, 0.0) * bD);
              float pvis = smoothstep(0.55, 0.2, aaF);
              float mS = min(abs(pty) * bD, 1.0 - bw);
              float frontB = lerp(bw, 1.0 - inRow, pvis);
              sideB = lerp(mS, sideB, pvis);
              wRow = lerp(max(1.0 - bw - mS, 0.0), wRow, pvis);
              litB = lerp(clamp(1.0 - max(ply, 0.0) * bD / max(1.0 - bw, 0.05), 0.0, 1.0), litB, pvis);
              float dSoff = (1.0 - fh) * floorH;
              float aoB = 1.0 - 0.30 * exp(-max(dSoff, 0.0) / (0.5 * bD + 0.05)) * pvis - 0.08 * (1.0 - pvis);
              float3 sideC = diffuseColor.rgb * (pty > 0.0 ? 0.82 : 0.96);
              float3 nA = albedo * frontB + sideC * sideB + albedo * aoB * wRow;
              float sunB = frontB + sideB * step(0.0, plN) * (pty > 0.0 ? 0.0 : 1.0) + wRow * litB;
              float tqWp = tqW * tqHero;
              albedo = lerp(albedo, nA, tqWp);
              FAC_emis *= lerp(1.0, frontB + wRow, tqWp);
              FAC_sunK = lerp(1.0, sunB, tqWp);
              FAC_nrmAdj += (pty > 0.0 ? -pB : pB) * 4.0 * sideB * tqWp;
            }
            if (tqW > 0.002 && tqHero > 0.001 && bldgH > 30.0 && ((style > 0.5 && style < 1.5) || (style > 3.5 && style < 4.5) || (style > 7.5 && style < 8.5))
                && !(store && v < storeH + 0.25) && v > 0.6) {
              float fl0 = floor((max(storeH, 3.0) + 0.5) / floorH) + 1.0;
              float flv = v / floorH;
              float kB = floor(flv - 0.95 - fl0 + 0.5);
              float kBelt = fl0 + max(0.0, floor((kB + 4.5) / 9.0) * 9.0);
              float bLo = (kBelt + 0.93) * floorH, bHi = bLo + 0.62;
              float cHi = bldgH - 0.35, cLo = cHi - 0.95;
              float useC = step(abs(v - (cLo + cHi) * 0.5), abs(v - (bLo + bHi) * 0.5));
              float lo = lerp(bLo, cLo, useC), hi = lerp(bHi, cHi, useC);
              float bP = lerp(0.28, 0.62, useC) * lerp(0.8, 1.2, H.hash12(float2(floor(cvar * 97.0), 3.9)));
              float3 bN = normalize(vNormal);
              float3 bUp = normalize(H.V3(float3(0.0, 1.0, 0.0)));
              float3 bT = normalize(cross(bN, bUp));
              float3 bB = normalize(cross(bN, bT)); if (dot(bB, bUp) < 0.0) bB = -bB;
              float3 bR = normalize(-vViewPosition);
              float bRz = max(dot(bR, -bN), 0.03);
              float by = dot(bR, bB) / bRz;
              float vF = v - by * bP;
              float aaM = max(H.fwk(v), 1e-4);
              float onF = smoothstep(lo - aaM, lo + aaM, vF) * (1.0 - smoothstep(hi - aaM, hi + aaM, vF));
              float sof = (1.0 - onF) * step(0.0, by) * smoothstep(lo - aaM, lo + aaM, v) * (1.0 - smoothstep(lo - aaM, lo + aaM, vF));
              float top = (1.0 - onF) * step(by, 0.0) * (1.0 - smoothstep(hi - aaM, hi + aaM, v)) * smoothstep(hi - aaM, hi + aaM, vF);
              sof = clamp(sof, 0.0, 1.0); top = clamp(top, 0.0, 1.0);
              float wallM = clamp(1.0 - onF - sof - top, 0.0, 1.0);
              float3 bL = normalize(H.V3(sunDirW));
              float bLN = dot(bL, bN);
              float bly = dot(bL, bB) / max(bLN, 0.02);
              float sh = smoothstep(lo - aaM, lo + aaM, v + max(bly, 0.0) * bP) * (1.0 - smoothstep(lo - aaM, lo + aaM, v));
              float bvis = smoothstep(0.35, 0.08, aaM);
              float3 stoneC = diffuseColor.rgb * float3(1.06, 1.04, 1.0);
              float nG = H.hash12(float2(floor(u / 1.4) + kBelt * 7.0, cvar * 31.0)) - 0.5;
              float3 bandA = stoneC * (1.0 + nG * 0.08) * (1.0 - 0.22 * smoothstep(lo + 0.2, lo, vF));
              float3 nA = albedo * wallM + bandA * onF + stoneC * 0.78 * sof + stoneC * 1.02 * top;
              float k = tqW * tqHero * bvis;
              albedo = lerp(albedo, nA, k);
              FAC_emis *= lerp(1.0, wallM, k);
              FAC_rough = lerp(FAC_rough, 0.84, k * (onF + sof + top));
              FAC_nrmAdj += (-bB * sof + bB * top) * 4.0 * k;
              FAC_sunK *= lerp(1.0, (1.0 - sh * wallM) * (1.0 - sof), k * (bLN > 0.0 ? 1.0 : 0.0));
              float drip = smoothstep(1.4, 0.0, lo - v) * step(v, lo) * (0.4 + 0.6 * H.vnoise(float2(u * 3.1 + cvar * 11.0, v * 0.4)));
              albedo *= 1.0 - drip * 0.22 * k;
            }
            if (tqW > 0.002 && bldgH > 12.0 && !(store && v < storeH)) {
              float fpW = max(H.fwk(u), H.fwk(v));
              float wVis = smoothstep(0.30, 0.07, fpW);
              albedo *= 1.0 - tqW * (glassStyle ? 0.08 : 0.16) * (1.0 - smoothstep(3.0, 32.0, v));
              float tqF = H.hash12(float2(floor(v / floorH) * 1.37 + cvar * 71.0, 3.3)) - 0.5;
              albedo *= 1.0 + tqW * tqF * (glassStyle ? 0.05 : 0.09) * smoothstep(0.9, 0.3, max(H.fwk(v / floorH), 1e-4));
              float dS = glassStyle ? frac(v / floorH - 0.30) : frac(fy - yb0);
              float colM = glassStyle ? 1.0 : H.pcov(cuC, xb0 - 0.04, xb1 + 0.04, aaU * 1.25);
              float sN = H.vnoise(float2(u * 2.3 + cvar * 17.0, v * 0.20 + cvar * 3.0));
              float strk = smoothstep(0.50, 0.86, sN) * exp(-(1.0 - dS) * floorH / (glassStyle ? 0.9 : 1.6));
              float strkM = strk * colM * wVis * (glassStyle ? (1.0 - winMask * 0.7) : (1.0 - winMask));
              albedo *= 1.0 - tqW * strkM * (glassStyle ? 0.22 : 0.30);
              FAC_rough = lerp(FAC_rough, min(FAC_rough + 0.12, 0.95), tqW * strkM);
            }
            /* (BD40: the Times Square screens' light, not carried by the records) */
          }
          albedo = pow(max(albedo, ((float3)(0.0))), ((float3)(1.22))) * 0.88;
        } else if (mech) {
          float lc = v / 0.24;
          float aaL = max(H.fwk(lc), 1e-4);
          float lVis = smoothstep(0.55, 0.16, aaL);
          float louv = H.pcov(lc, 0.14, 0.90, aaL * 1.25);
          float lBank = 1.0;
          float mpv = -1.0, mWallL = max(vAux3.x, 0.01);
          if (faceH > 0.05) {
            mpv = v - (bldgH - faceH);
            float bLo = max(0.9, faceH * 0.34), bHi = max(bLo + 0.6, faceH - 0.75);
            float aaPv = max(H.fwk(mpv), 1e-4);
            float bV = smoothstep(bLo - aaPv, bLo + 0.10 + aaPv, mpv) * smoothstep(bHi + aaPv, bHi - 0.10 - aaPv, mpv);
            float nBay = mWallL > 11.0 ? 3.0 : mWallL > 5.5 ? 2.0 : 1.0;
            float inset = min(1.4, mWallL * 0.13);
            float bu = (u - inset) / max(0.01, (mWallL - 2.0 * inset) / nBay);
            float aaBu = max(H.fwk(bu), 1e-4);
            float bH = H.pcov(bu, 0.06, 0.94, aaBu * 1.25) * step(0.0, bu) * step(bu, nBay);
            lBank = clamp(bV * bH, 0.0, 1.0);
          }
          float mFam = H.hash12(float2(floor(cvar * 317.0), 23.9));
          if (mFam < 0.58) {
            float3 mCol = mFam < 0.26 ? float3(0.255, 0.150, 0.120)
                      : mFam < 0.44 ? float3(0.300, 0.258, 0.205)
                      : float3(0.340, 0.330, 0.300);
            albedo = mCol * (0.88 + 0.26 * H.hash12(float2(cvar * 97.0, 7.3)));
            albedo *= 1.0 - smoothstep(0.45, 0.9, H.fbm(float2(u * 0.8, v * 0.25) + cvar * 13.0)) * 0.26;
            albedo *= 0.93 + 0.14 * H.vnoise(float2(u * 2.3 + cvar * 41.0, v * 0.18));
          }
          albedo *= lerp(1.0, lerp(0.80, 0.62 + 0.52 * louv, lVis), lBank);
          if (mpv > -0.5) {
            float dCol2 = 0.0;
            float dSeed = H.hash12(float2(floor(vAux3.y * 64.0) * 3.1, cvar * 83.0));
            if (dSeed < 0.38 && mWallL > 3.2) {
              float dx = 0.9 + H.hash12(float2(dSeed * 311.0, cvar * 7.7)) * max(0.0, mWallL - 1.8);
              float aaDu = max(H.fwk(u), 1e-4), aaDv = max(H.fwk(mpv), 1e-4);
              float dM = smoothstep(0.525 + aaDu, 0.525 - aaDu, abs(u - dx))
                       * smoothstep(2.2 + aaDv, 2.2 - aaDv, mpv) * step(0.06, mpv);
              float frM = smoothstep(0.66 + aaDu, 0.66 - aaDu, abs(u - dx))
                        * smoothstep(2.36 + aaDv, 2.36 - aaDv, mpv) * step(0.0, mpv) - dM;
              albedo = lerp(albedo, albedo * 1.28 + ((float3)(0.03)), clamp(frM, 0.0, 1.0) * 0.7);
              albedo = lerp(albedo, float3(0.085, 0.082, 0.078), dM * 0.92);
              FAC_rough = lerp(FAC_rough, 0.48, dM * 0.8);
              dCol2 = dM;
            }
            float curb = smoothstep(0.30, 0.10, mpv);
            albedo = lerp(albedo, float3(0.075, 0.072, 0.068), curb * 0.72 * (1.0 - dCol2));
            albedo *= 1.0 - smoothstep(1.4, 0.28, mpv) * (0.35 + 0.45 * H.fbm(float2(u * 0.7, mpv * 1.1) + cvar * 67.0)) * 0.22;
            albedo *= 1.0 - smoothstep(0.62, 0.95, H.vnoise(float2(u * 1.5 + cvar * 19.0, mpv * 0.30))) * 0.15;
          }
          float mu = u / 1.35;
          float aaM = max(H.fwk(mu), 1e-4);
          albedo *= lerp(1.0, 0.88 + 0.16 * H.pcov(mu, 0.07, 0.93, aaM * 1.25), smoothstep(0.5, 0.15, aaM));
          albedo *= 0.94 + 0.12 * H.fbm(float2(u * 0.6, v * 0.6) + cvar * 29.0);
          FAC_rough = 0.42 + 0.2 * louv;
          FAC_nrmAdj += float3(0.0, (louv - 0.5) * 0.25 * lVis, 0.0);
          {
            float ck = H.hash12(float2(floor(cvar * 251.0), 17.31));
            float3 cCol = ck < 0.58 ? float3(1.0, 0.87, 0.64)
                      : ck < 0.86 ? float3(0.80, 0.88, 1.0)
                      : lerp(float3(1.0, 0.42, 0.32), float3(0.35, 0.72, 1.0), H.hash12(float2(cvar * 91.0, 3.17)));
            float onC = step(0.22, H.hash12(float2(cvar * 137.0, 9.7)));
            float upl = lerp(0.38, 1.0, smoothstep(0.0, 9.0, bldgH - v));
            FAC_emis += cCol * night * onC * upl * 1.25 * (0.55 + 0.55 * louv);
            albedo = lerp(albedo, albedo * (0.7 + 0.5 * dot(cCol, ((float3)(0.33)))), night * onC * 0.4);
          }
          if (avLight) {
            float bl = 0.55 + 0.45 * sin(uTimeF * 1.9 + cvar * 40.0);
            albedo = float3(0.30, 0.05, 0.05);
            FAC_emis += float3(1.0, 0.12, 0.06) * (0.8 + 2.6 * night) * bl;
            FAC_rough = 0.35;
          }
          albedo = pow(max(albedo, ((float3)(0.0))), ((float3)(1.22))) * 0.88;
        } else if (crownF) {
          float crs = v / 0.62;
          float aaC = max(H.fwk(crs), 1e-4);
          float cVis = smoothstep(0.55, 0.16, aaC);
          float cJ = 1.0 - H.pcov(crs, 0.05, 0.97, aaC * 1.25);
          float blk = u / 1.25 + H.gmod(floor(crs), 2.0) * 0.5;
          float aaB = max(H.fwk(blk), 1e-4);
          float bJ = 1.0 - H.pcov(blk, 0.03, 0.985, aaB * 1.25);
          albedo *= 1.0 - max(cJ, bJ * 0.7) * 0.28 * cVis;
          albedo *= 0.95 + 0.12 * H.fbm(float2(u * 0.5, v * 0.5) + cvar * 17.0);
          albedo *= 1.0 - smoothstep(0.55, 0.92, H.fbm(float2(u * 0.09, v * 0.2) + cvar * 7.0)) * 0.12;
          FAC_rough = 0.72;
          FAC_nrmAdj += float3(ddx(-cJ), -ddy(-cJ), 0.0) * 0.3 * cVis;
          {
            float ck = H.hash12(float2(floor(cvar * 251.0), 17.31));
            float3 cCol = ck < 0.72 ? float3(1.0, 0.88, 0.66) : float3(0.82, 0.89, 1.0);
            float onC = step(0.26, H.hash12(float2(cvar * 137.0, 9.7)));
            FAC_emis += cCol * night * onC * lerp(0.4, 1.0, smoothstep(0.0, 12.0, bldgH - v)) * 0.95;
          }
          albedo = pow(max(albedo, ((float3)(0.0))), ((float3)(1.22))) * 0.88;
        } else {
          FAC_dbg = 3.0;
          float n = H.fbm(float2(vFUv.x * 2.0, vFUv.y * 2.1));
          albedo *= 0.88 + 0.12 * n;
          albedo *= 1.0 - 0.14 * (1.0 - smoothstep(0.0, 9.0, vFUv.y));
          FAC_rough = 0.95;
          if (faceH > 0.05) {
            float pv = vFUv.y - (bldgH - faceH);
            float pu = vFUv.x;
            float gN = 0.4 + 0.6 * H.fbm(float2(pu * 0.55, pv * 0.9) + cvar * 53.0);
            if (faceIn) {
              float turn = smoothstep(0.34, 0.05, pv);
              albedo = lerp(albedo, float3(0.055, 0.052, 0.050), turn * 0.80);
              FAC_rough = lerp(FAC_rough, 0.68, turn * 0.7);
              albedo *= 1.0 - smoothstep(1.5, 0.1, pv) * gN * 0.26;
              albedo *= 0.80 + 0.14 * H.fbm(float2(pu * 0.22, pv * 0.6) + cvar * 11.0);
            } else {
              float dCop = faceH - pv;
              albedo *= 1.0 - smoothstep(0.55, 0.02, dCop) * smoothstep(-0.03, 0.06, dCop) * gN * 0.24;
              float strk = smoothstep(0.58, 0.93, H.vnoise(float2(pu * 1.9 + cvar * 37.0, pv * 0.35)));
              albedo *= 1.0 - strk * smoothstep(faceH, 0.0, pv) * 0.18;
            }
          }
        }
        FAC_emis += float3(0.35, 0.24, 0.12) * night * (1.0 - smoothstep(0.0, 6.5, vFUv.y)) * 0.14;
        diffuseColor.rgb = albedo;
      }

// ---- roughness: the facade's, then rain-damp masonry
float roughnessFactor = FAC_rough;
{
  float dampF = wet * smoothstep(0.5, 0.85, FAC_rough);
  diffuseColor.rgb *= 1.0 - 0.26 * dampF;
  roughnessFactor = lerp(roughnessFactor, 0.4, dampF * 0.55);
}
float metalnessFactor = max(0.0, FAC_metal);
// ---- the normal: the page's, in its view space
float3 normal = normalize(vNormal);
        normal = normalize(normal + FAC_nrmAdj);
        {
          // (S125: walls only: the brick's normal map at the facade's uv drew brick courses across rough gravel and
          // membrane roofs, plank-like streaks under a low sun)
          float upF = step(0.7, normalize(NWS).z);
          float bw = smoothstep(0.86, 0.9, FAC_rough) * smoothstep(0.20, 0.07, length(H.fwk(vWP))) * (1.0 - upF);
          if (bw > 0.02) {
            float2 buv = float2(vFUv.x, vFUv.y) * 0.42;
            float3 mapN = Texture2DSample(TbrN, TbrNSampler, buv).xyz * 2.0 - 1.0;
            float3 q0 = ddx(-vViewPosition), q1 = -ddy(-vViewPosition);
            float2 st0 = ddx(buv), st1 = -ddy(buv);
            float3 Tt = q0 * st1.y - q1 * st0.y;
            float3 Bt = -q0 * st1.x + q1 * st0.x;
            float tl = max(length(Tt), 1e-6), bl = max(length(Bt), 1e-6);
            
            float3 pnK = normalize(float3(mapN.xy * 1.3, max(mapN.z, 0.4))); float3 pn = (Tt / tl) * pnK.x + (Bt / bl) * pnK.y + normal * pnK.z;
            if (dot(pn, pn) > 1e-8) normal = normalize(lerp(normal, normalize(pn), bw * 0.8));
            FAC_rough = lerp(FAC_rough, Texture2DSample(TbrR, TbrRSampler, buv).x * 1.05, bw * 0.5);
          }
        }
        {
          float bumpG = smoothstep(0.45, 0.75, FAC_rough);
          bumpG *= smoothstep(0.12, 0.045, length(H.fwk(vWP))) * (1.0 - step(0.7, normalize(NWS).z));   // (S125: not on roofs: noise at a grazing view)
          float bh = dot(diffuseColor.rgb, ((float3)(1.05))) * bumpG;
          float3 bsx = ddx(-vViewPosition), bsy = -ddy(-vViewPosition);
          float3 br1 = cross(bsy, normal), br2 = cross(normal, bsx);
          float bdet = dot(bsx, br1);
          float3 bgrad = sign(bdet) * (ddx(bh) * br1 + -ddy(bh) * br2);
          float bgl = length(bgrad);
          bgrad *= min(bgl, 0.35) / max(bgl, 1e-5);
          float3 bn = abs(bdet) * normal - bgrad * 1.1;
          if (dot(bn, bn) > 1e-9) normal = normalize(bn);
        }
        diffuseColor.rgb *= FAC_grainV;

// ---- FP18 (v105): the glass layer. A pane is glass over a room: what is seen through it is the room's own light, not the
// sun on the pane (the room painted as the base colour lit as a flat panel in the sun, black in the shade); its surface is
// mirror smooth (between 0.1 and Lumen's 0.6 the traced reflections are stochastic, and the curtain walls' panes flipped
// from frame to frame on a moving lens) and each pane sits at its own small tilt (hashed from its cell: the same every
// frame), bowed a little where it spans pixels, so the reflections break pane to pane as real glazing does
{
  float gm = saturate(UE_gm);
  if (gm > 0.0) {
    float3 Vv = normalize(vViewPosition);
    float3 Ng = normalize(vNormal); if (dot(Ng, Vv) < 0.0) Ng = -Ng;
    float cosV = saturate(dot(Ng, Vv));
    // (v106: the room's range compressed (the blinds and lit rooms a checkerboard of beige panes at v105), its ambient
    // daylight as light of its own, and the sun that enters it as a dim diffuse share of the pane, so a shadow across a
    // glass wall still reads, softened, as it does on real glazing)
    float3 aI = diffuseColor.rgb / (1.0 + 2.5 * dot(diffuseColor.rgb, float3(0.2126, 0.7152, 0.0722)));
    float kIn = 0.14 * (1.0 - 0.85 * night);
    float tr = 1.0 - H.fresnelR(cosV, 0.06);
    FAC_emis += aI * kIn * tr * gm;
    diffuseColor.rgb = lerp(diffuseColor.rgb, aI * 0.22 * tr + 0.003, gm);
    // (v108: the pane's footprint decides how sharp its mirror can be: a pane a few pixels across reflects through a
    // lobe wide enough that its neighbours' tilts and a moving lens do not flip it; mirror only where it spans many)
    float rG = lerp(0.018, 0.30, smoothstep(0.03, 0.35, UE_aa));
    roughnessFactor = lerp(roughnessFactor, rG, gm);
    // (v107: a punched window's two sashes, above and below its meeting rail, each at its own tilt)
    float pV2 = UE_pV * 2.0 + (1.0 - UE_gs) * step(0.6, UE_fy);
    float h1 = H.hash12(float2(UE_pU * 1.731 + UE_pS * 0.37, pV2 * 2.113 + 4.1)) - 0.5;
    float h2 = H.hash12(float2(pV2 * 3.917 + UE_pS * 0.11, UE_pU * 1.373 + 9.7)) - 0.5;
    float3 upv = normalize(H.V3(float3(0.0, 1.0, 0.0)));
    float3 Tt = cross(Ng, upv); Tt = dot(Tt, Tt) > 1e-6 ? normalize(Tt) : float3(1.0, 0.0, 0.0);
    float3 Bt = normalize(cross(Tt, Ng));
    // (v107: a punched window's old glass sits less true than a curtain wall's (+-0.02 rad against +-0.012), and one in
    // twenty is a hopper left open, its pane leaning back 0.06-0.14 rad to the sky)
    float h3 = H.hash12(float2(UE_pU * 5.171 + UE_pS * 0.23, UE_pV * 7.713 + 1.9));
    float2 tl = float2(h1, h2) * lerp(0.04, 0.024, UE_gs) * smoothstep(0.30, 0.06, UE_aa) + float2(UE_fx - 0.5, UE_fy - 0.5) * 0.02 * smoothstep(0.12, 0.03, UE_aa);
    tl.y += (1.0 - UE_gs) * step(h3, 0.05) * lerp(0.06, 0.14, frac(h3 * 37.0)) * smoothstep(0.30, 0.06, UE_aa);
    normal = normalize(lerp(normal, normalize(normal + Tt * tl.x + Bt * tl.y), gm));
  }
  // (the curtain walls' spandrel glass: the same glass on an opaque backing)
  roughnessFactor = lerp(roughnessFactor, 0.07, saturate(UE_sp) * 0.85);
}
// (three's geometric specular AA, applySpecAA: sigma2 0.25, kappa 0.14; v108: after the glass layer, so it sees the panes' tilts)
{
  float3 ndx = ddx(normal), ndy = ddy(normal);
  float variance = 0.25 * (dot(ndx, ndx) + dot(ndy, ndy));
  float kernel = min(2.0 * variance, 0.14);
  roughnessFactor = min(sqrt(roughnessFactor * roughnessFactor + kernel), 1.0);
}
// ---- glass: the family's F0 (tinted) and its own dark diffuse; above Unreal's 0.08 dielectric ceiling partly metallic
float3 base = diffuseColor.rgb;
float metal = metalnessFactor;
float spec = 0.5;
float g = saturate(UE_glass);
if (g > 0.0) {
  float3 f3 = UE_f0 * FAC_reflTint;
  float f = dot(f3, float3(0.2126, 0.7152, 0.0722));
  float d = max(dot(base, float3(0.2126, 0.7152, 0.0722)), 1e-4);
  if (f <= 0.08) {
    spec = lerp(0.5, f / 0.08, g);
  } else {
    // diffuse d and F0 f with Specular 0.5: base (1 - m) = d, 0.04 (1 - m) + m base = f
    float x = clamp(((d + f) - sqrt(max((d + f) * (d + f) - 0.16 * d, 0.0))) / 0.08, 0.05, 1.0);
    float m = 1.0 - x;
    float3 b = m > 1e-3 ? max((f3 - 0.04 * x) / m, 0.0) : base;
    base = lerp(base, b, g);
    metal = lerp(metal, m, g);
  }
}
Emis = FAC_emis * EmisK;
Rough = roughnessFactor;
Metal = saturate(metal);
Spec = spec;
NrmW = normalize(H.tw2ue(H.W3(normal)));
return base;
