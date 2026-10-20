// ez-tree street trees (MIT, github.com/dgreenheck/ez-tree): replaces the
// procedural puff trees with parametric trunks/branches + textured leaf cards.
// Same pool-geometry-swap pattern as props.js — instances (real street-tree
// census positions) stay; trunk pools get a bark-textured material, crown
// pools keep the shared wind/snow crownMat whose map becomes the ez-tree leaf.
import * as THREE from 'three';
import { ENV, applySnowCap, applyLightTrim, applyCityAO } from '../world/materials.js';
import { alphaMipTexture, alphaMipDataTexture, TREE_ARCH, TV25, TREE_FORMS, TV25_POOLS, tv25Spec, TV25_BAKE } from './furnitureKit.js';
import { buildTree, bakeKey25, TR36_FORMS, TREE36_VERSION } from './treeGen.js';
import { ATLAS, LEAF_CELLS, STREET_CELLS, cellUV25, paintLeafAtlas25, planeCamoCanvas25 } from './treeAtlas.js';
import { geo38Decode } from './treeGeo38.js';
import { ktx2Loader } from './mat/ktx2.js';

// TC13 STREET CANOPY (docs/notes/canopy-r13.md, critic-r13 ranked fix 9).
// `?tc13=0` restores the r12 crown: height-only normalisation, 0.32x leaf
// count, and the near-white colour bake. One parse site per file.
const TC13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('tc13') === '0');
// FD14 (docs/notes/fd14.md) — ?fd14=0 restores the TC13 crown. In THIS file: leaf card
// area and count (the crowns are still see-through at 3x; critic-r14 fix 8).
const FD14T = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fd14') === '0');
export async function upgradeTrees(instancer) {
  if (TV25) return upgradeTreesTV25(instancer);   // TV25 species forms (below); ?tv25=0 runs the round-14 build
  const tBoot0 = performance.now();   // (TV25 boot census: timing only)
  const { Tree } = await import('@dgreenheck/ez-tree');
  const tBoot1 = performance.now();
  // variant pools per species: same preset, DIFFERENT SEEDS + small parameter
  // jitter, so neighboring street trees stop being clones.
  // TC13 adds `k` — this variant's size relative to its archetype's mature
  // envelope (TREE_ARCH) — and `d`, its leaf density relative to the archetype:
  // a honeylocust is an OPEN crown you can read the sky through, a plane is a
  // solid mass. targetH stays as the ?tc13=0 fallback.
  const SPECIES = [
    ['A', 'Oak Medium', 0x3f6d2e, 11.5, 4171, 0.97, 1.00],
    ['A2', 'Oak Medium', 0x426f2c, 12.4, 9313, 1.07, 1.06],
    ['A3', 'Oak Medium', 0x3c682f, 10.8, 22571, 0.90, 0.94],
    ['B', 'Ash Medium', 0x4a7a33, 9.0, 517, 0.95, 0.80],
    ['B2', 'Ash Medium', 0x4e7d30, 9.8, 7789, 1.05, 0.86],
    ['C', 'Aspen Small', 0x5d8a3c, 7.6, 1201, 0.95, 0.92],
    ['C2', 'Aspen Small', 0x578540, 8.4, 30011, 1.05, 0.98],
  ];
  let leafTex = null, barkMat = null;
  for (const [sp, preset, tint, targetH0, seed, kVar, dVar] of SPECIES) {
    const arch = TREE_ARCH[sp[0]] || TREE_ARCH.A;
    const targetH = TC13 ? arch.h * kVar : targetH0;
    const targetW = TC13 ? arch.w * kVar : 0;
    const pT = instancer.pools.get('tree' + sp + 'Trunk');
    const pC = instancer.pools.get('tree' + sp + 'Crown');
    if (!pT || !pC) continue;
    try {
      const tree = new Tree();
      tree.loadPreset(preset);
      // cap density: pools hold thousands of instances — a preset tree at
      // full detail would be 5-10x our budget
      const o = tree.options;
      o.seed = seed;
      const jit = ((seed % 97) / 97 - 0.5); // deterministic per-variant jitter
      // radial segments / length sections per branch level: the trunk pools
      // were the single biggest triangle sink in the frame (6.4M per variant
      // at {8,6,4,3}); thin branches read identically at 3-4 radial segs
      o.branch.segments = { 0: 6, 1: 3, 2: 3, 3: 3 };
      o.branch.sections = { 0: 5, 1: 3, 2: 2, 3: 1 };
      // leaves.count is PER TERMINAL BRANCH (x children product x double
      // billboards) — cut density, grow card size to keep canopy coverage
      // TC13: 0.32x count / 1.5x card was a SEE-THROUGH crown — the 3x zoom
      // shots/canopy-r13/v_wb_tree.png is branches with a few leaf clusters on
      // them, and the twin measured 0.74 % vegetation against the reference's 6.10 %.
      // Coverage goes as count * size^2 but COST goes as count alone, so buy
      // most of it in the card: 2.15x card area for zero extra triangles, and
      // 1.44x count to close the gaps between cards. Net ~3.1x canopy coverage
      // for +44 % leaf triangles and NO new pools (draw calls unchanged).
      // FD14 (critic-r14 fix 8): TC13's own argument, applied once more. Canopy is 1.8 /
      // 4.0 / 3.3 % of frame against the references' 3.4 / 9.8 / 10.4 %, and at 3x the
      // crowns are still see-through — the Amsterdam street tree (fd14/before/amst_tree.png)
      // reads the whole facade through it, where a London plane in July is a solid mass.
      // Coverage goes as count * size^2 and COST goes as count alone, so again buy it in
      // the card: 2.55/2.2 is +34 % of card AREA for zero triangles, and count goes up only
      // 15 %. Net ~1.54x crown coverage for +15 % leaf tris. `?fd14=0` restores TC13.
      const DENS = TC13 ? (FD14T ? 0.53 : 0.46) * dVar : 0.32;
      o.leaves.count = Math.max(4, Math.round(o.leaves.count * (DENS + jit * 0.08)));
      o.leaves.size *= (TC13 ? (FD14T ? 2.55 : 2.2) : 1.5) + jit * 0.25;
      if (o.branch.angle) o.branch.angle[1] = (o.branch.angle[1] ?? 0) + jit * 12;
      if (o.branch.children[2] > 2) o.branch.children[2] = 2;
      tree.generate();

      const trunkG = tree.branchesMesh.geometry.clone();
      const leafG = tree.leavesMesh.geometry.clone();
      for (const g of [trunkG, leafG]) {
        for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      }
      // one uniform scale for the whole tree: match the species target height
      const bb = new THREE.Box3().setFromBufferAttribute(trunkG.getAttribute('position'));
      const bbL = new THREE.Box3().setFromBufferAttribute(leafG.getAttribute('position'));
      bb.union(bbL);
      const s = targetH / Math.max(bb.max.y, 0.01);
      // TC13 CANOPY WIDTH. Height-only normalisation left the crown diameter at
      // whatever the preset gave after the branch-budget cuts (branch.levels and
      // children[2] both trimmed, which NARROWS an ez-tree). Measured on the
      // Williamsburg twin: ~5 m crowns. A mature London plane, pin oak or
      // honeylocust on a New York street is 10-15 m across. Normalise XZ to the
      // archetype envelope as well, clamped so the trunk never turns into a
      // column (the same factor scales the branch mesh, which is what keeps the
      // leaf cards ON the branch tips) — a 1.55 cap is a 55 % fatter bole at
      // dbh 30", which is what a 90-year-old plane's bole looks like.
      let sw = s;
      if (TC13) {
        const cw = Math.max(bbL.max.x - bbL.min.x, bbL.max.z - bbL.min.z) * s;
        sw = s * Math.min(1.55, Math.max(0.80, targetW / Math.max(cw, 0.01)));
      }
      trunkG.scale(sw, s, sw);
      leafG.scale(sw, s, sw);
      // leaf cards lit by their own facing direction go half-black — use the
      // crown-volume radial normal (position from canopy center + up bias),
      // the same contract that fixed the faceted puff trees
      {
        const pos = leafG.getAttribute('position');
        const nor = leafG.getAttribute('normal');
        // keep the TRUE card facing before it is overwritten: the crown shader
        // fades cards seen edge-on (critic round 2: bright fully-lit slivers)
        leafG.setAttribute('aFace', new THREE.BufferAttribute(Float32Array.from(nor.array), 3));
        const cb = new THREE.Box3().setFromBufferAttribute(pos);
        const cc = cb.getCenter(new THREE.Vector3());
        cc.y = cb.min.y + (cb.max.y - cb.min.y) * 0.62;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.set(pos.getX(i) - cc.x, pos.getY(i) - cc.y, pos.getZ(i) - cc.z).normalize();
          v.y += 0.55; // strong up bias — canopy undersides live off sky light
          v.normalize();
          nor.setXYZ(i, v.x, v.y, v.z);
        }
      }

      // baked colors: white on bark (texture carries the look), per-leaf
      // green variation on the crown (crownMat multiplies map * vColor)
      const bakeCol = (g, fn) => {
        const n = g.getAttribute('position').count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) fn(i).toArray(arr, i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      };
      bakeCol(trunkG, () => new THREE.Color(1, 1, 1));
      // the leaf map is already fully colored — vColor is only a brightness/
      // hue JITTER around white (a saturated tint double-multiplies to black)
      const base = new THREE.Color(tint);
      const white = new THREE.Color(1, 1, 1);
      const c2 = new THREE.Color();
      // TC13 CHROMA, NOT BRIGHTNESS. The r12 bake multiplied an already-lit,
      // already-coloured leaf map by a near-white value brightened 1.00-1.45,
      // and the top of that range pushes the green channel into tone-map
      // compression — which is precisely what "desaturated to near-white in a
      // summer scene" is. Measured: our foliage LUMINANCE already matched the
      // Bedford Ave pano (93,108,89 vs 89,112,85); its mean SATURATION was
      // 0.210 against the pano's 0.312. So: normalise the species tint to unit
      // LUMA before blending (the blend then moves hue and chroma only, not
      // brightness) and centre the per-card jitter on 1.0 instead of 1.225.
      const tintN = new THREE.Color(tint);
      tintN.multiplyScalar(1 / Math.max(1e-4, 0.2126 * tintN.r + 0.7152 * tintN.g + 0.0722 * tintN.b));
      const leafCol = (i) => {
        const leaf = (i / 4) | 0; // 4 verts per card
        const h = Math.sin(leaf * 127.1) * 43758.5453;
        const r = h - Math.floor(h);
        // FD14: more CHROMA and a trimmed top end on the per-card jitter. The jitter ran
        // 0.88-1.12 about a unit-luma tint, so an eighth of the cards were 12 % hotter
        // than the sheet and those are the ones that clip on the sun side; 0.86-1.02 caps
        // it without flattening the crown, and 0.46 of tint (was 0.32) keeps the bright
        // cards GREEN through the tone-map shoulder instead of letting them go neutral.
        return TC13
          ? c2.copy(white).lerp(tintN, FD14T ? 0.46 : 0.32).multiplyScalar(FD14T ? 0.86 + r * 0.16 : 0.88 + r * 0.24)
          : c2.copy(white).lerp(base, 0.15).multiplyScalar(1.0 + r * 0.45);
      };
      bakeCol(leafG, leafCol);

      if (!barkMat) {
        const src = tree.branchesMesh.material;
        barkMat = applySnowCap(new THREE.MeshStandardMaterial({
          map: src.map ?? null, normalMap: src.normalMap ?? null,
          roughness: 0.92, metalness: 0, vertexColors: true,
        }));
      }
      if (!leafTex) leafTex = tree.leavesMesh.material.map;

      const oldT = pT.mesh.geometry, oldC = pC.mesh.geometry;
      pT.mesh.geometry = trunkG;
      pT.mesh.material = barkMat;
      pC.mesh.geometry = leafG;
      oldT.dispose(); oldC.dispose();
      {
        // TC13 census: the canopy envelope actually achieved, so a regression in
        // the ez-tree preset or the branch budget shows up in the console rather
        // than in a plate three hours later.
        const cb2 = new THREE.Box3().setFromBufferAttribute(leafG.getAttribute('position'));
        console.log(`[trees] ${sp} <- ${preset}: trunk ${(trunkG.index ? trunkG.index.count : trunkG.getAttribute('position').count) / 3 | 0} tris,`
          + ` ${leafG.getAttribute('position').count / 4 | 0} leaves, canopy ${(Math.max(cb2.max.x - cb2.min.x, cb2.max.z - cb2.min.z)).toFixed(1)}m wide`
          + ` x ${cb2.max.y.toFixed(1)}m tall (target ${TC13 ? targetW.toFixed(1) : '-'} x ${targetH.toFixed(1)})`);
      }

      // distance LOD (instancer routes instances past 120 m here): same seed,
      // preset and height, branches at the minimum segment/section counts and
      // half the leaf cards at 1.4x size — at ≤60 px tall the canopy reads the
      // same; ~1/4 of the triangles. Trees were 14M of the 20M tris in view.
      if (instancer.setLOD) {
        try {
          const lt = new Tree();
          lt.loadPreset(preset);
          const lo = lt.options;
          lo.seed = seed;
          lo.branch.segments = { 0: 4, 1: 3, 2: 3, 3: 3 };
          lo.branch.sections = { 0: 3, 1: 2, 2: 1, 3: 1 };
          lo.branch.levels = Math.min(lo.branch.levels ?? 3, 2);
          // TC13 holds the FAR-FIELD budget flat. `o.leaves.count` is already the
          // boosted near count, so the r12 0.5x would have carried the whole
          // +44 % into the LOD as well; 0.38x x a 2.0x card puts the far crown
          // back within ~9 % of r12's leaf triangles at MORE coverage, which is
          // the half of the frame that costs the most (every tree past 120 m).
          lo.leaves.count = Math.max(3, Math.round(o.leaves.count * (TC13 ? 0.38 : 0.5)));
          lo.leaves.size = o.leaves.size * (TC13 ? 2.0 : 1.4);
          if (lo.branch.angle) lo.branch.angle[1] = (lo.branch.angle[1] ?? 0) + jit * 12;
          if (lo.branch.children[2] > 2) lo.branch.children[2] = 2;
          lt.generate();
          const trunkL = lt.branchesMesh.geometry.clone();
          const leafL = lt.leavesMesh.geometry.clone();
          for (const g of [trunkL, leafL]) {
            for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
          }
          // TC13: THE FAR LOD MUST BE THE SAME TREE. It is built with
          // branch.levels capped at 2, which shortens AND narrows an ez-tree, so
          // reusing the near build's `s`/`sw` shrank the canopy at the 120 m
          // handover — a crown that pops smaller is the swap announcing itself.
          // Normalise this build to the SAME envelope instead of inheriting a
          // scale measured on a different geometry.
          let lsH = s, lsW = sw;
          if (TC13) {
            const lb = new THREE.Box3().setFromBufferAttribute(trunkL.getAttribute('position'));
            const lbL = new THREE.Box3().setFromBufferAttribute(leafL.getAttribute('position'));
            lb.union(lbL);
            lsH = targetH / Math.max(lb.max.y, 0.01);
            const lcw = Math.max(lbL.max.x - lbL.min.x, lbL.max.z - lbL.min.z) * lsH;
            lsW = lsH * Math.min(1.75, Math.max(0.80, targetW / Math.max(lcw, 0.01)));
          }
          for (const g of [trunkL, leafL]) g.scale(lsW, lsH, lsW);
          {
            const pos = leafL.getAttribute('position');
            const nor = leafL.getAttribute('normal');
            leafL.setAttribute('aFace', new THREE.BufferAttribute(Float32Array.from(nor.array), 3)); // true card facing (edge-on fade)
            const cb = new THREE.Box3().setFromBufferAttribute(pos);
            const cc = cb.getCenter(new THREE.Vector3());
            cc.y = cb.min.y + (cb.max.y - cb.min.y) * 0.62;
            const v = new THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
              v.set(pos.getX(i) - cc.x, pos.getY(i) - cc.y, pos.getZ(i) - cc.z).normalize();
              v.y += 0.55; v.normalize();
              nor.setXYZ(i, v.x, v.y, v.z);
            }
          }
          bakeCol(trunkL, () => new THREE.Color(1, 1, 1));
          bakeCol(leafL, leafCol);   // TC13: same chroma contract as the near build
          instancer.setLOD('tree' + sp + 'Trunk', trunkL, 120);
          instancer.setLOD('tree' + sp + 'Crown', leafL, 120);
          console.log(`[trees] ${sp} LOD: trunk ${(trunkL.index ? trunkL.index.count : trunkL.getAttribute('position').count) / 3 | 0} tris, ${leafL.getAttribute('position').count / 4 | 0} leaves,`
            + ` h ${(new THREE.Box3().setFromBufferAttribute(leafL.getAttribute('position')).max.y).toFixed(1)}m`);
        } catch (e) { console.warn('[trees] LOD failed', sp, e); }
      }
    } catch (e) { console.warn('[trees] failed', sp, e); }
  }
  applyEdgeFade(instancer);
  if (typeof window !== 'undefined') window.__TREE25_BOOT = { from: 'ez-tree', wallMs: performance.now() - tBoot0, mainMs: performance.now() - tBoot1, readyS: performance.now() / 1000 };
  console.log(`[trees] ez-tree build: ${(performance.now() - tBoot0).toFixed(0)} ms wall, ${(performance.now() - tBoot1).toFixed(0)} ms main thread after the module import`);
  // the shared crown material now samples the ez-tree leaf card texture.
  // MIP RULE for alpha cutouts: transparent texels ship with BLACK rgb, and
  // street-distance mips blend that black into every sample (slate canopy) —
  // flood-fill transparent rgb with the mean leaf color before upload.
  if (leafTex) {
    const apply = () => {
      const img = leafTex.image;
      if (!img || !img.width) { setTimeout(apply, 120); return; }
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height);
      const px = d.data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
      if (n) { r /= n; g /= n; b /= n; }
      // ---- FD14 LEAF ALBEDO CAP (owner note 2026-09-17: "the lit tops of the crowns go
      // near-white, which turns the biggest object in the frame into a pale cloud").
      // MEASURED on the ez-tree source art (node_modules/@dgreenheck/ez-tree/src/lib/
      // assets/leaves): oak_color is a good albedo at mean 96,126,54 but its p95 is L 163
      // and its max L 207; ash_color the same; **aspen_color — which the C archetype
      // (callery pear / ginkgo) uses — is an AUTUMN card, mean 195,150,56, with 32 % of
      // its texels above L 170.** Those are baked highlights, not albedo: a real leaf
      // reflects 0.10-0.20, i.e. sRGB 90-125, and a 163-207 albedo under a direct sun
      // clips to white and then desaturates in the tone-map shoulder. Reference: the lit
      // foliage in critic-r13/WB_bedN7.png measures 118,142,116 — never neutral.
      // So the top end is shouldered: L <= KNEE is untouched (the mean and the hue of the
      // card are preserved), and [KNEE, 255] is remapped onto [KNEE, CAP] at constant
      // chromaticity. On oak that moves a 163 texel to 128 and a 207 to 139 and leaves
      // three quarters of the card alone; on the aspen card it takes the whole sheet down
      // to a leaf albedo. `?fd14=0` skips it.
      const KNEE = 118, CAP = 150;
      if (FD14T) {   // …and the transparent-texel flood fill is that same capped mean
        const Lm = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (Lm > KNEE) {
          const k = (KNEE + (CAP - KNEE) * Math.min(1, (Lm - KNEE) / (255 - KNEE))) / Lm;
          r *= k; g *= k; b *= k;
        }
      }
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        if (FD14T && a >= 128) {
          const L = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          if (L > KNEE) {
            const k = (KNEE + (CAP - KNEE) * Math.min(1, (L - KNEE) / (255 - KNEE))) / L;
            px[i] *= k; px[i + 1] *= k; px[i + 2] *= k;
          }
        }
        if (a < 128) { px[i] = r; px[i + 1] = g; px[i + 2] = b; }
        else if (a < 250) {
          // canvas 2D round-trips premultiplied — un-premultiply semi-alpha
          // edge texels or every leaf border darkens toward black in the mips
          const k = 255 / a;
          px[i] = Math.min(255, px[i] * k); px[i + 1] = Math.min(255, px[i + 1] * k); px[i + 2] = Math.min(255, px[i + 2] * k);
        }
      }
      ctx.putImageData(d, 0, 0);
      // r8: the flood fill above only fixes the COLOUR of the mip chain. The
      // ALPHA still box-averages a binary cutout, so the canopy loses coverage
      // with every level and slides through alphaTest as the footprint changes
      // — the dominant motion artefact in glitch-r7.md 2.2 family B. Build the
      // chain here instead, with each level's alpha rescaled to preserve
      // level 0's coverage at the 0.35 this material cuts at (?aa=0 reverts).
      const t2 = alphaMipTexture(cv, 0.35, { name: 'ezleaf' });
      instancer.crownMat.map = t2;
      instancer.crownMat.alphaTest = 0.35;
      instancer.crownMat.needsUpdate = true;
      console.log('[trees] leaf texture mip-safe fill applied');
    };
    apply();
  }
}

// EDGE-ON FADE: leaf cards carry crown-radial normals for lighting, so a card
// seen edge-on is still "fully lit" and, after the alpha test, renders as a
// bright hairline sliver (critic round 2, defect 9). `aFace` (set above) is
// the card's true facing; fade alpha as the view direction grazes it, before
// the alpha test discards. Geometries without `aFace` read (0,0,0) -> no fade.
// (TV25: factored out of upgradeTrees unchanged, so both builds share it.)
function applyEdgeFade(instancer) {
  if (!instancer.crownMat.__edgeFade) {
    const m = instancer.crownMat;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aFace; varying float vFaceDot;')
        .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec3 fN = aFace;
          #ifdef USE_INSTANCING
            fN = mat3(instanceMatrix) * fN;
          #endif
          fN = normalMatrix * fN;
          float fl = length(fN);
          vFaceDot = fl < 0.5 ? 1.0 : abs(dot(normalize(-mvPosition.xyz), fN / fl));
        }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFaceDot;')
        .replace('#include <alphatest_fragment>', 'diffuseColor.a *= smoothstep(0.10, 0.32, vFaceDot);\n#include <alphatest_fragment>');
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|edgefade';
    m.__edgeFade = true;
    m.needsUpdate = true;
  }
}

// =====================================================================================================================
// TV25 SPECIES TREES (trees agent, 2026-09-25). `?tv25=0` runs the round-14 build above, untouched.
//
// What the round-14 build did, measured before this was written (scratchpad trees_agent/notes.md):
//   * 74 % of the census drew ONE ez-tree preset in three seeds, one oak spray for every crown, the road's yaw on
//     every tree in a row -> same-variant neighbours were exact clones;
//   * the oak spray card was ~1.8 m, so its leaves rendered ~28 cm (2x a real leaf): the "coarse card" canopy;
//   * the crown albedo was the spray x the c13 tint decoded to LINEAR (0.047, 0.084, 0.033): ~0.018 green, a tenth
//     of a leaf, while the IBL specular was not scaled at all -> crowns measured (35-46, 40-60, 42-56), neutral to
//     blue-grey with a pale sheen on grazing cards, where Street View foliage is clearly yellow-green;
//   * DoubleSide + crown-volume normals: three flips the normal on back faces, so ~half the cards shaded with an
//     INWARD normal (salt-and-pepper dark cards);
//   * the bark had no light trim (props take 0.30 x STREET_CAL), so trunks rendered pale.
// TV25: per-species forms from city/treeGen.js; a 2048^2 (TR35: 2560^2, 5 x 5 cells) leaf atlas of species sprays at the right leaf scale
// (painted here, plus ez-tree's oak/ash sprays and its aspen spray recoloured for linden); four bark materials
// with the prop light trim; the crown shaded with outward normals on both faces, wrap + transmission for thin
// backlit leaves, and the baked crown AO on the ambient; far trees carry their trunk in the crown LOD.
// FP26 (the film, ?filmlod=1): no crown LOD switch inside the near tiles. At 90 m every tree the lens passed changed shape
// as it crossed (film 9: the College Walk opener, frame 109); at 260 m a 12 m crown is still ~95 px tall on a 1440 p
// frame. A take renders offline, so every near tree draws its full crown and trunk; `?treelod=<m>` overrides.
const T25Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const T25 = { NC: ATLAS.NC, CS: ATLAS.CS, ALPHA: 0.42, LOD: Number(T25Q?.get('treelod')) || (T25Q?.get('filmlod') === '1' ? 1e4 : 90) };
// TR34 (AR34 wave 2: the street trees of 125th Street and Hunters Point, docs/notes/ar34-trees.md). In this file: the bark
// (below, upgradeTreesTV25), the leaf shading and the dithered leaf edge (TR34S, TR34D: both follow TR34). `?tr34=0`
// restores the TC26 bark and crown; the generator's TR34 half (treeGen.js) is in the bake and has no switch.
// `?ta2c=1` is a measurement switch only: the crown cut through alpha-to-coverage (instancer.js records why it is off).
const TR34 = !(T25Q && T25Q.get('tr34') === '0');
const TA2C = !!(T25Q && T25Q.get('ta2c') === '1');
// TR34 leaf shading (`?tr34s=0` alone restores the TC26 crown): a card used to be ONE flat tone of one spray, which is the
// cut-out look; a real shoot is twenty leaves each turned its own way, some catching the sun with a waxy glint. A leaf-scale
// value noise in the atlas (~34 atlas px cells: a cell is 512 px and its leaves 40-130 px) breaks the card up in value and
// a little in hue, and gates the TC26 cuticle sheen (off since TC26) per leaf: only the top of the noise glints.
const TR34S = TR34 && !(T25Q && T25Q.get('tr34s') === '0');
// TR34 dithered leaf edge (`?tr34d=0` restores the hard cut). Alpha-to-coverage on this pipeline's 2 MSAA samples changed
// nothing visible (shots/ar34/trees/w2r1b_a2c vs w2r1a, s120 crown at 1.5x) and instancer.js measured it non-deterministic.
// What engines with temporal AA do instead is a dithered opacity mask: within one pixel's alpha step of the cut the
// threshold takes an interleaved-gradient-noise offset that changes every frame, and the TAA history (or the film's
// accumulation) integrates it into a partial-coverage edge. Away from the cut nothing changes, so the coverage holds.
const TR34D = TR34 && !(T25Q && T25Q.get('tr34d') === '0');
const DITH34 = { value: 0 };
// TR35 STREET LEAVES (AR34 wave 2 round 2; the lead's review of the segments' sheets, 2026-10-01 23:53: "bright lime-green,
// standing in the 125th Street and Hunters Point boxes (city/areas.js B125, BHPT) samples the street copies of its leaf
// cells (treeAtlas.js STREET_CELLS: an olive pinnate honeylocust in place of the yellow-green bipinnate fern, and a darker,
// less saturated sophora, oak, linden; a lighter, bluer pear); everything else keeps the cells as they were. (The first
// version swapped them everywhere outside Central Park's rectangle: one park A/B of it put the teaser's golden Mall at
// luma 61.2 against 67.4 for the round-1 trees at the same engine (shots/ar34/trees/cp_w2r2_c, cp_w2r2_v5ctl), a second
// run of the same code at 67.3 (cp_w2r2_final): not understood, so the swap stays inside the two boxes until it is.)
// `?tr35=0` restores the old cells everywhere; `?tr35=all` swaps them everywhere (A/B only).
const TR35 = !(T25Q && T25Q.get('tr35') === '0');
const ALL35 = !!(T25Q && T25Q.get('tr35') === 'all');
// `?tr35=city` (measurement): the boxes and every crown outside Central Park's rectangle (the minimum rectangle round
// cpFloraData CP_PARK: centre (477.0, 71.7), axis (-0.48405, 0.87504), half sizes 2056.9 x 419.8 m)
const CITY35 = !!(T25Q && T25Q.get('tr35') === 'city');
const PARK35 = { value: new THREE.Vector4(477.0, 71.7, -0.48405, 0.87504) }, PARKH35 = { value: new THREE.Vector2(CITY35 ? 2056.9 : -1, 419.8) };
const BOXA35 = { value: ALL35 ? new THREE.Vector4(-1e6, -1e6, 1e6, 1e6) : new THREE.Vector4(600, -4400, 3750, -1450) };
const BOXB35 = { value: new THREE.Vector4(350, 3250, 1850, 5350) };
const CELL35 = Object.entries(STREET_CELLS).map(([a, b]) => `if ( abs( c - ${a}.0 ) < 0.5 ) return ${b}.0;`).join(' ');
// TR36 (2026-10-02, the owner: "improve trees and vegetation to a UE5 / Quixel / AAA level"; docs/notes/ar34-trees.md). The
// forms in treeGen.js TR36_FORMS (the honeylocust H, H2, H9 and the sophora S so far) draw a finer crown baked by
// tools/ar35/trees/bake36.mjs into public/models/trees36: twigs on every leafy shoot carrying small folded cards of
// composed CC0 leaf scans (once-pinnate honeylocust spur clusters, pinnate sophora shoots) with a leaf normal map and a
// translucency channel, ~33-53k triangles a tree near the lens (LOD1 ~3.6k); scanned bark at 2K. Their crowns take a TR36 material
// chained on the shared crown program (the TV25 / TC26 / TR34 shading, the wind, the edge fade, the snow) plus: the leaf
// relief on the crown-volume normal, translucency on the transmitted light, branch sway and leaf flutter from the wind
// clock (ENV.windT: frozen at dt = 0, so bshot's settle and the film recorder stay deterministic), the bark the same sway.
// The atlas is calibrated to the TR35 street cells; outside the TR35 boxes the crowns take the trees25 park colour of
// their species (PARK36: park cell / street cell, linear), so Central Park keeps its palette. `?tr36=0` restores trees25.
const TR36 = !(T25Q && T25Q.get('tr36') === '0');
const BAKE36 = 'models/trees36/';
const TR36_FETCH = (TR36 && TV25 && typeof window !== 'undefined' && typeof fetch === 'function' && !/(^|[?&])tv25gen=1/.test(location.search))
  ? {
    json: fetch(BAKE36 + 'trees36.json', { priority: 'high' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    bin: fetch(BAKE36 + 'trees36.bin', { priority: 'high' }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
    // TR38 (bake format v3): the leaf atlas and the leaf normal + translucency atlas as KTX2 files of their own
    leafCol: fetch(BAKE36 + 'leaf_col.ktx2', { priority: 'high' }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
    leafNrm: fetch(BAKE36 + 'leaf_nrm.ktx2', { priority: 'high' }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
  }
  : null;
// x leaf relief gain, y / z the transmission at translucency 0 (veins, rachis, twigs) / 1 (the leaf blade), w the diffuse
// share of the blade's transmission (trees25: 0.3 of `away`). A thin leaf passes about as much green light as it reflects, so
// (x 1.0 -> 0.7 in v7: the leaflet tilts lowered the mean N.L of the sunlit tops; the lead's 05:59 review asks for lighter tops)
// (TR38: y / z / w 0.35 / 1.15 / 0.8 -> 0.42 / 1.35 / 0.9, a little more glow through the blades from below: crown38.py at
const LEAF36 = { value: new THREE.Vector4(0.7, 0.42, 1.35, 0.9) };
// x the skylight a blade passes to its underside (x its translucency, the baked sky visibility and how much the normal faces
// down; TR36 v5): from below, a sunlit crown under a bright sky glows. trees25 had only the sun's transmission, and the
// y: a ceiling on a TR36 leaf's outgoing radiance (linear, before the tone map), a guard against single-pixel fireflies only.
// (Tried at 1.5 on the soft red halos of s313 / the golden Mall: they stayed, and the trees25 control has one too, so they are
// not leaf fireflies. 1.5 and 8 rendered the front-lit views alike (tr36f, tr36g); 8 keeps it a pure guard.) z, w spare
const LEAF36B = { value: new THREE.Vector4(2.2, 8.0, 1.6, 0) };   // (TR38: x 1.5 -> 2.2; z the direct gain, 1.6 from the e38 sweep)
// trees25 park cell / TR35 street cell (linear means of the baked atlases, 2026-10-02): honeylocust 5 / 16, sophora 1 / 18;
// TR37: oak 0 / 19 (the plane and the zelkova have no street copy: their cells are calibrated to the one trees25 cell)
const PARK36 = { H: [2.2, 2.03, 0.567], S: [1.025, 1.355, 0.645], Q: [1.15, 1.405, 0.631] };
// TR38 sweep handles (URL; the defaults are the values above): `?leaf36=x,y,z,w`, `?leaf36b=x,y`, and `?crown38=k` or
// `?crown38=r,g,b`, a gain on every TR36 crown's albedo (the material colour; no atlas change)
const CROWN38 = [1, 1, 1];
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const nums = (k) => (q?.get(k) || '').split(',').filter((v) => v !== '').map(Number).filter((v) => Number.isFinite(v));
  const a = nums('leaf36'); if (a.length === 4) LEAF36.value.set(a[0], a[1], a[2], a[3]);
  const b = nums('leaf36b'); if (b.length >= 1) { LEAF36B.value.x = b[0]; if (b.length > 1) LEAF36B.value.y = b[1]; if (b.length > 2) LEAF36B.value.z = b[2]; }
  const c = nums('crown38'); if (c.length === 1) CROWN38.fill(c[0]); else if (c.length === 3) CROWN38.splice(0, 3, ...c);
}
if (typeof window !== 'undefined') window.__TREE36 = { LEAF36, LEAF36B, PARK36, CROWN38 };
// the sway every TR36 vertex takes, crown and bark alike (a smooth field over the tree: twigs and their leaves move as one);
// the bark also takes the instancer's rooted whole-tree bend (instancer.js crownMat), which the crown already has
const WIND36 = (bark) => `
{
  #ifdef USE_INSTANCING
    vec2 iw36 = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
  #else
    vec2 iw36 = vec2( 0.0 );
  #endif
  float ph0 = fract( iw36.x * 0.171 + iw36.y * 0.113 ) * 6.283;
  ${bark ? `float hgt36 = max( position.y - 1.6, 0.0 );
  transformed.xz += vec2( sin( windT * 1.05 + ph0 ) * 0.8 + 0.35, cos( windT * 0.83 + ph0 * 1.31 ) * 0.6 ) * ( hgt36 * hgt36 * 0.0028 * windAmp );` : ''}
  float wb36 = smoothstep( 0.6, 4.5, length( position.xz ) ) * smoothstep( 1.5, 5.0, position.y );
  float ph36 = ph0 + dot( position, vec3( 0.73, 0.21, 0.57 ) );
  transformed.xz += vec2( sin( windT * 1.7 + ph36 ), cos( windT * 1.3 + ph36 * 1.2 ) * 0.6 ) * ( 0.1 * windAmp * wb36 );
  ${bark ? '' : 'transformed += aFace * ( sin( windT * 7.3 + aWind.y * 6.283 + position.y * 1.3 ) * 0.07 * windAmp * aWind.x );'}
}
`;
// calibration uniforms, live-tunable from a measurement page (window.__TREE25)
// FL28 (2026-09-27, the teaser; the owner's reference stills are autumn, "more colorful"): `?fall=0..1` turns the
// crowns: per tree one of yellow, orange, red or a yellow-green, 16 % stay green, at the leaf's own luminance (so the
// calibrated brightness holds), and the transmitted light warms with it. Off (0) by default: the sim and the ad are summer.
const FALL28 = { value: T25Q ? Math.min(1, Math.max(0, +(T25Q.get('fall') || 0))) : 0 };
const LEAF25 = {
  gain: { value: new THREE.Vector3(1.75, 1.75, 1.55) },       // x mix(0.30, 0.88, night): the prop light-trim contract
  light: { value: new THREE.Vector4(0.4, 4.0, 0.45, 0.3) },  // x transmission, y its view exponent, z AO on direct, w wrap
  trans: { value: new THREE.Vector3(0.85, 1.25, 0.3) },       // transmitted tint (chlorophyll passes a deep yellow-green)
  // direct-diffuse gain, indirect-diffuse gain, indirect-specular gain, AO floor. A canopy's shade is lit by light the
  // leaves around it scattered (each passes ~10 % and reflects ~10 %): measured against Street View the first TV25 plates
  // had the shaded crown at ~0.45x the reference while sun-facing cards blew out to cream, i.e. too much key, too little fill.
  // Swept at harlemRow (sweep1/sweep3): (0.72, 1.5) left sun-facing cards cream and the shade at ~0.5x the reference;
  // (0.32, 3.2) puts the mid canopy at (96-102, 109-115, 44-46) against Street View's (93-123, 113-143, 50-69).
  bal: { value: new THREE.Vector4(0.32, 3.2, 0.75, 0.3) },
  // TC26 sun self-shadow: x floor, y peak (mixed by the baked sun visibility toward the actual sun), z visibility exponent,
  // w clump-normal weight on the sun's diffuse
  sun: { value: new THREE.Vector4(0.08, 1.25, 1.2, 1.5) },
  // TC26 waxy sheen: x roughness, y gain, z true-card-facing share of its normal; w per-clump tone amplitude
  sheen: { value: new THREE.Vector4(0.5, 0.0, 0.5, 0.10) },
  // TC26 clump sky: x how much ambient a clump's underside loses (tops keep theirs: nothing is lifted), y the sheen's F90,
  // z the indirect gain at night (replaces bal.y as ENV.night goes 0.15 -> 0.6; golden 0.05 keeps bal.y)
  clu: { value: new THREE.Vector4(0.6, 0.5, 1.2, 0) },
  // TC26 sun share: the SUN's reflected light (diffuse + specular) is multiplied by this on top of bal.x, and nothing else
  // is. bal.x scales the transmission and the lamps as well, which is why raising it to deepen the lit side whitened
  // every backlit crown; this keeps those at their calibration while the sunlit clump shells carry more of the light.
  // y: the share of that reflection left where the camera sees a clump from its FAR side (a backlit crown seen from below):
  // there the light arrives through the leaves (the transmission term), and lighting the far side as if its sunlit top were
  // in view is what put cream highlights on every backlit crown
  // z: the sun's specular on its own (1 = as bal.x gives it). Swept 2026-09-26 (lead sw8/sw9/sw11, harlemRow front-lit,
  // columbia backlit, amst120N shade): x 1.45 gives the sunlit clumps their depth, the far-side share 0.25 takes the
  // backlit cream (warm pale pixels 0.46 % at TC26 as shipped, 0.34 % TV25) back down, the shade crown is untouched.
  sunK: { value: new THREE.Vector3(1.45, 0.25, 1.0) },
};
// TR34: the cuticle sheen on, gated per leaf in the shader (leaf34s = 0.15 + 1.7 n^3 of the leaf noise n: above 1 for n > 0.79):
// a little rougher than a single waxy lobe, more of the card's own facing in its normal so the glints sit on single leaves
if (TR34S) LEAF25.sheen.value.set(0.42, 0.5, 0.6, 0.10);
// TC26 (2026-09-25 night): the sunlit half of a crown read as ONE flat tone, because the only occlusion on the sun was the
// sky AO (direction-blind) over a half-volume, half-clump normal. Now the bake carries each vertex's visibility toward any
// sun direction (aSun: a linear fit of the leaf-density transmittance, treeGen.js) and the pure clump normal (aClu, with a
// per-clump tone), so the sun lights the sun-side shell of every clump, the clump's far side and the crown interior fall
// into their own shade, and a rougher cuticle lobe gives waxy leaves their sheen. Lamps keep the sky AO, and the crown sees
// them as finite luminaires (cityLamps.js CL_R0): the near field no longer blows the crown out under the lamp head.
// The day terms are ON at the TV25 balance (backlit check: no lift, columbia 104,130,101 -> 104,129,102; the lit half of a
// front-lit crown gains cluster shade, lead sweep sw3 harlemRow). A larger direct share (0.55) gave more depth front-lit but
// whitened backlit crowns, so the balance stays. `?tc26=0` restores TV25 by day exactly; window.__TC26(on) switches in place.
// The NIGHT half (N26: CL_R0 near field + the night indirect gain) is on; `?tc26n=0` restores TV25 at night exactly.
let TC26 = !(typeof location !== 'undefined' && /(^|[?&])tc26=0/.test(location.search));
const N26 = !(typeof location !== 'undefined' && /(^|[?&])tc26n=0/.test(location.search));
if (typeof window !== 'undefined') window.__TREE25 = LEAF25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- leaf atlas cells (cell index = cx + cy * NC, v up; 15 = solid bark swatch for the far-LOD trunk proxy)
// (leaf atlas cells, sprays and the plane bark painter live in ./treeAtlas.js — shared with the offline bake)
async function texImage25(tex) {
  for (let i = 0; i < 240 && !(tex && tex.image && tex.image.width); i++) await sleep(50);
  return tex && tex.image && tex.image.width ? tex.image : null;
}
function canvasTex25(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function wrapTex25(img, srgb) {
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
// TC26: the crown takes the street lamps as finite luminaires (cityLamps.js CL_R0, metres): leaves 1-3 m from a lamp head
// sat in its inverse-square near field and blew out
function tc26Defines(m) {
  m.defines = { ...(m.defines || {}) };
  if (TC26 || N26) m.defines.CL_R0 = '2.5';
  else delete m.defines.CL_R0;
}
// the crown's TV25 shading, chained after every other hook on the shared crownMat
function applyCrownShading25(m) {
  if (m.__tv25) return;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uLeafGain = LEAF25.gain; sh.uniforms.uLeafLight = LEAF25.light; sh.uniforms.uLeafTrans = LEAF25.trans; sh.uniforms.uLeafBal = LEAF25.bal;
    sh.uniforms.uLeafNight = ENV.night;
    sh.uniforms.uFall28 = FALL28;
    sh.uniforms.uDith34 = DITH34;
    if (TR35) { sh.uniforms.uBoxA35 = BOXA35; sh.uniforms.uBoxB35 = BOXB35; sh.uniforms.uPark35 = PARK35; sh.uniforms.uParkH35 = PARKH35; }
    if (TC26) { sh.uniforms.uLeafSun = LEAF25.sun; sh.uniforms.uLeafSheen = LEAF25.sheen; sh.uniforms.uLeafClu = LEAF25.clu; sh.uniforms.uLeafSunK = LEAF25.sunK; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO25; varying float vFall28;' + (TR35 ? '\nuniform vec4 uBoxA35; uniform vec4 uBoxB35; uniform vec4 uPark35; uniform vec2 uParkH35; varying float vStreet35;' : '') + (TC26 ? '\nattribute vec4 aSun; attribute vec3 aClu; varying vec4 vSun26; varying vec3 vClu26; varying vec3 vFace26; varying float vTone26;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO25 = aAO;\n#ifdef USE_INSTANCING\nvec3 ip28 = instanceMatrix[3].xyz;\n#else\nvec3 ip28 = vec3(0.0);\n#endif\nvFall28 = fract(sin(dot(floor(ip28.xz * 0.5) + 0.37, vec2(12.9898, 78.233))) * 43758.5453);' + (TR35 ? `
      {
        // TR35: in the 125th Street / Hunters Point boxes (the instance's root; a mesh without instancing, each vertex) -> the
        // street leaf cells
        #ifdef USE_INSTANCING
          vec3 w35 = ( modelMatrix * vec4( ip28, 1.0 ) ).xyz;
        #else
          vec3 w35 = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #endif
        bvec4 a35 = bvec4( w35.x > uBoxA35.x, w35.z > uBoxA35.y, w35.x < uBoxA35.z, w35.z < uBoxA35.w );
        bvec4 b35 = bvec4( w35.x > uBoxB35.x, w35.z > uBoxB35.y, w35.x < uBoxB35.z, w35.z < uBoxB35.w );
        vStreet35 = all( a35 ) || all( b35 ) ? 1.0 : 0.0;
        if ( uParkH35.x > 0.0 ) {
          vec2 q35 = w35.xz - uPark35.xy;
          if ( !( abs( dot( q35, uPark35.zw ) ) < uParkH35.x && abs( dot( q35, vec2( -uPark35.w, uPark35.z ) ) ) < uParkH35.y ) ) vStreet35 = 1.0;
        }
      }` : '') + (TC26 ? `
      {
        // TC26: the sun visibility gradient, the clump normal and the card facing into view space (a missing attribute
        // reads (0,0,0,1): fully visible, no clump, no facing)
        mat3 m26 = mat3( modelViewMatrix );
        #ifdef USE_INSTANCING
          m26 = m26 * mat3( instanceMatrix );
        #endif
        float sl26 = length( aSun.xyz ), cl26 = length( aClu );
        vec3 s26 = m26 * aSun.xyz, c26 = m26 * aClu, f26 = m26 * aFace;
        vSun26 = vec4( sl26 > 1e-3 ? normalize( s26 ) * sl26 : vec3( 0.0 ), aSun.w );
        vClu26 = cl26 > 0.3 ? normalize( c26 ) : vec3( 0.0 );
        vTone26 = cl26 > 0.3 ? clamp( ( cl26 - 0.75 ) * 4.0, -1.0, 1.0 ) : 0.0;
        vFace26 = length( f26 ) > 1e-3 ? normalize( f26 ) : vec3( 0.0 );
      }` : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLeafGain; uniform vec4 uLeafLight; uniform vec3 uLeafTrans; uniform vec4 uLeafBal; uniform float uLeafNight; varying float vAO25; uniform float uFall28; varying float vFall28; float leaf28Fall = 0.0;'
        + '\nfloat leaf34 = 0.5; float leaf34s = 1.0; uniform float uDith34; float h34( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }'
        + (TR35 ? `\nvarying float vStreet35; float cell35( float c ) { ${CELL35} return -1.0; }` : '')
        + (TC26 ? '\nuniform vec4 uLeafSun; uniform vec4 uLeafSheen; uniform vec4 uLeafClu; uniform vec3 uLeafSunK; varying vec4 vSun26; varying vec3 vClu26; varying vec3 vFace26; varying float vTone26; float leaf26Sun = 0.0;' : ''))
      // the prop light-trim contract (materials.js applyLightTrim), with the atlas carrying a real leaf albedo
      // (TC26: x a per-clump tone, lighter and warmer or darker and cooler, so clumps read as units)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= uLeafGain * mix(0.30, 0.88, uLeafNight)'
        + (TC26 ? ' * ( 1.0 + uLeafSheen.w * vTone26 * vec3( 1.3, 1.0, 0.45 ) );' : ';')
        // FL28: autumn, at the leaf's own luminance
        + `\nif ( uFall28 > 0.001 ) {
  float hf28 = vFall28;
  vec3 fc28 = hf28 < 0.28 ? vec3( 1.00, 0.66, 0.12 ) : hf28 < 0.52 ? vec3( 1.00, 0.42, 0.08 ) : hf28 < 0.68 ? vec3( 0.74, 0.19, 0.07 ) : hf28 < 0.84 ? vec3( 0.82, 0.76, 0.22 ) : vec3( -1.0 );
  if ( fc28.x >= 0.0 ) {
    float L28 = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    leaf28Fall = uFall28 * ( 0.80 + 0.20 * fract( hf28 * 71.0 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, fc28 * ( L28 / max( 1e-3, dot( fc28, vec3( 0.2126, 0.7152, 0.0722 ) ) ) ) * 1.12, leaf28Fall );
  }
}` + (TR34S ? `
#ifdef USE_MAP
{
  // TR34: per-leaf value and hue (mean ~0.98, so the crown's calibrated brightness holds) and the per-leaf sheen gate
  vec2 lc34 = vMapUv * ${(15 * ATLAS.NC).toFixed(1)}, li34 = floor( lc34 ), lf34 = fract( lc34 );   // (15 noise cells per atlas cell: 60 at 4 x 4, TR35 75 at 5 x 5)
  lf34 = lf34 * lf34 * ( 3.0 - 2.0 * lf34 );
  leaf34 = mix( mix( h34( li34 ), h34( li34 + vec2( 1.0, 0.0 ) ), lf34.x ), mix( h34( li34 + vec2( 0.0, 1.0 ) ), h34( li34 + vec2( 1.0, 1.0 ) ), lf34.x ), lf34.y );
  #ifdef TR36_CROWN
  // (TR36: the atlas carries each scanned leaflet's own value and hue; the noise only breaks up the repeats)
  diffuseColor.rgb *= mix( 0.93, 1.05, leaf34 );
  #else
  diffuseColor.rgb *= mix( 0.80, 1.16, leaf34 ) * vec3( 1.0 + ( leaf34 - 0.5 ) * 0.08, 1.0, 1.0 - ( leaf34 - 0.5 ) * 0.14 );
  #endif
  leaf34s = 0.15 + 1.7 * leaf34 * leaf34 * leaf34;
}
#endif` : ''))
      // TR35: a street crown samples the street copy of its cell (the card's UVs move by whole cells: the same derivatives)
      .replace('#include <map_fragment>', TR35 ? `#ifdef USE_MAP
  vec2 uv35 = vMapUv;
  #ifndef TR36_CROWN
  if ( vStreet35 > 0.5 ) {
    vec2 c35 = floor( vMapUv * ${ATLAS.NC}.0 );
    float t35 = cell35( c35.x + c35.y * ${ATLAS.NC}.0 );
    if ( t35 >= 0.0 ) uv35 += ( vec2( mod( t35, ${ATLAS.NC}.0 ), floor( t35 / ${ATLAS.NC}.0 ) ) - c35 ) / ${ATLAS.NC}.0;
  }
  #endif
  vec4 sampledDiffuseColor = texture2D( map, uv35 );
  diffuseColor *= sampledDiffuseColor;
#endif` : '#include <map_fragment>')
      // TR34D: the dithered edge band, last before the cut (after the instancer's footprint ramp and the edge-on fade)
      .replace('#include <alphatest_fragment>', TR34D ? `{
  float aw34 = min( fwidth( diffuseColor.a ), 0.25 );
  vec2 fc34 = gl_FragCoord.xy + vec2( 5.588238, 2.471643 ) * uDith34;
  diffuseColor.a += ( fract( 52.9829189 * fract( dot( fc34, vec2( 0.06711056, 0.00583715 ) ) ) ) - 0.5 ) * aw34 * 1.6;
}
#include <alphatest_fragment>` : '#include <alphatest_fragment>')
      // both faces of a card take the OUTWARD crown-volume normal (three flips it on back faces)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif')
      // wrap + transmission: thin leaves light around the terminator, and a backlit crown rim glows
      .replace('#include <lights_physical_pars_fragment>', TC26 ? `#include <lights_physical_pars_fragment>
void RE_Direct_Leaf25( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  // lamps (and any light but the sun): the sky AO on the direct, as in TV25
  vec3 N = geometryNormal;
  float occ = mix( 1.0, vAO25, uLeafLight.z );
  if ( leaf26Sun > 0.5 ) {
    // the sun: clump-weighted normal, and the baked visibility toward THIS light direction (per-clump self-shadowing)
    N = normalize( geometryNormal + vClu26 * uLeafSun.w );
    float vis = saturate( vSun26.w + dot( vSun26.xyz, directLight.direction ) );
    occ = mix( uLeafSun.x, uLeafSun.y, pow( vis, uLeafSun.z ) );
  }
  vec3 col = directLight.color * occ;
  float dotNL = dot( N, directLight.direction );
  float w = uLeafLight.w;
  vec3 irradiance = saturate( ( dotNL + w ) / ( 1.0 + w ) ) * col;
  // the sun's reflection only (not the transmission, not the lamps), and only on the side of the clump the camera sees
  float seen = dot( vClu26, vClu26 ) > 0.25 ? smoothstep( -0.3, 0.35, dot( vClu26, geometryViewDir ) ) : 1.0;
  float kSun = leaf26Sun > 0.5 ? uLeafSunK.x * mix( uLeafSunK.y, 1.0, seen ) : 1.0;
  reflectedLight.directSpecular += saturate( dotNL ) * col * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, N, material ) * kSun * ( leaf26Sun > 0.5 ? uLeafSunK.z : 1.0 );
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * kSun;
  float back = pow( saturate( dot( geometryViewDir, -directLight.direction ) ), uLeafLight.y );
  float away = saturate( -dotNL );
  // (transmission takes the visibility but never the sunlit lift: a backlit crown goes darker green with glowing rims)
  reflectedLight.directDiffuse += directLight.color * min( occ, 1.0 ) * material.diffuseContribution * mix( uLeafTrans, vec3( 1.35, 0.72, 0.22 ), leaf28Fall ) * ( 0.3 * away + back ) * uLeafLight.x * RECIPROCAL_PI;
  if ( leaf26Sun > 0.5 && uLeafSheen.y > 0.0 ) {
    // waxy cuticle sheen: a rougher lobe on a normal between the clump's and the card's own (turned to the viewer)
    vec3 F = vFace26 * ( dot( vFace26, geometryViewDir ) < 0.0 ? -1.0 : 1.0 );
    vec3 Ns = normalize( mix( N, F, uLeafSheen.z ) + N * 1e-3 );
    PhysicalMaterial ms = material;
    ms.roughness = uLeafSheen.x;
    ms.specularColorBlended = vec3( 0.04 );
    ms.specularF90 = uLeafClu.y;
    reflectedLight.directSpecular += saturate( dot( Ns, directLight.direction ) ) * col * BRDF_GGX( directLight.direction, geometryViewDir, Ns, ms ) * uLeafSheen.y * leaf34s;
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf25` : `#include <lights_physical_pars_fragment>
void RE_Direct_Leaf25( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float dotNL = dot( geometryNormal, directLight.direction );
  float w = uLeafLight.w;
  vec3 irradiance = saturate( ( dotNL + w ) / ( 1.0 + w ) ) * directLight.color;
  reflectedLight.directSpecular += saturate( dotNL ) * directLight.color * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
  float back = pow( saturate( dot( geometryViewDir, -directLight.direction ) ), uLeafLight.y );
  float away = saturate( -dotNL );
  reflectedLight.directDiffuse += directLight.color * material.diffuseContribution * uLeafTrans * ( 0.3 * away + back ) * uLeafLight.x * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf25`)
      // baked crown AO: all of the ambient, part of the direct (self-shadowing the shadow map is too coarse for)
      .replace('#include <lights_fragment_end>', TC26 ? `#include <lights_fragment_end>
      // (the canopy's multiple-scattering gain is a DAYLIGHT calibration: at night the ambient is the warm street bounce, and
      // x3.2 on it lit every crown in the street like a lamp; night takes uLeafClu.z)
      reflectedLight.indirectDiffuse *= mix(uLeafBal.w, 1.0, vAO25) * mix( uLeafBal.y, uLeafClu.z, smoothstep( 0.15, 0.6, uLeafNight ) )
        * ( 1.0 - uLeafClu.x * 0.5 * saturate( -dot( vClu26, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) ) );
      reflectedLight.indirectSpecular *= mix(0.35, 1.0, vAO25) * uLeafBal.z;
      reflectedLight.directDiffuse *= uLeafBal.x;
      reflectedLight.directSpecular *= uLeafBal.x;` : `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= mix(uLeafBal.w, 1.0, vAO25) * uLeafBal.y;
      reflectedLight.indirectSpecular *= mix(0.35, 1.0, vAO25) * uLeafBal.z;
      reflectedLight.directDiffuse *= mix(1.0, vAO25, uLeafLight.z) * uLeafBal.x;
      reflectedLight.directSpecular *= mix(1.0, vAO25, uLeafLight.z) * uLeafBal.x;`);
    // TC26: flag the directional (sun) loop, so RE_Direct_Leaf25 knows the sun from the street lamps and headlamps
    if (TC26) {
      const lfb = THREE.ShaderChunk.lights_fragment_begin, mk = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
      if (lfb.includes(mk)) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', lfb.replace(mk, 'leaf26Sun = 1.0;\n' + mk));
    }
  };
  tc26Defines(m);
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + (TC26 ? '|tv25|tc26' : '|tv25') + (TR34S ? '|tr34' : '') + (TR34D ? '|tr34d' : '') + (TR35 ? '|tr35' : '');
  // measurement pages: window.__TC26(false|true) switches the crown between TV25 and TC26 shading in place (one recompile)
  if (typeof window !== 'undefined') window.__TC26 = (on) => { TC26 = !!on; tc26Defines(m); m.needsUpdate = true; return TC26; };
  m.__tv25 = true;
  m.needsUpdate = true;
}

// ---- the TV25 set: BAKED (public/models/trees25, tools/bake_trees.mjs) or, when the bake is missing or stale, generated
// here. Both return { geos: Map(base -> { trunk0, leaves0, leaves1, bark }), atlas, barkTex, stats, main }.
// `main` is the main-thread time spent (the loader's work is fetches and image decodes, which run off the main thread).
const BAKE25 = 'models/trees25/';
const TA25 = { f32: Float32Array, i8: Int8Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, f16: Uint16Array };
function geoFromBake25(bin, G) {
  const g = new THREE.BufferGeometry();
  // (TR37: 'f16' = half floats, drawn as such: the trees36 bake's positions, colours and leaf uvs)
  for (const [name, [off, count, size, type, norm]] of Object.entries(G.attrs)) {
    const arr = new TA25[type](bin, off, count * size);
    g.setAttribute(name, type === 'f16' ? new THREE.Float16BufferAttribute(arr, size) : new THREE.BufferAttribute(arr, size, norm));
  }
  const [ioff, icount, itype] = G.index;
  g.setIndex(new THREE.BufferAttribute(new TA25[itype](bin, ioff, icount), 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
function texFromBitmap25(bm, srgb) {
  const t = new THREE.Texture(bm);
  t.flipY = false;   // ImageBitmaps ignore UNPACK_FLIP_Y; the bark is decoded flipped (imageOrientation) to match TextureLoader
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
// gzip -> ArrayBuffer off the main thread: a throwaway worker running DecompressionStream (main-thread fallback)
function gunzip25(getSlice) {
  const inflate = (b) => new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  try {
    const src = "onmessage=async(e)=>{try{const o=await new Response(new Blob([e.data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();postMessage(o,[o]);}catch(err){postMessage(null);}}";
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    return new Promise((res) => {
      const done = (v) => { w.terminate(); URL.revokeObjectURL(url); res(v); };
      w.onmessage = (e) => done(e.data || inflate(getSlice()));
      w.onerror = () => done(inflate(getSlice()));
      const c = getSlice();
      w.postMessage(c, [c]);
    });
  } catch (e) { return inflate(getSlice()); }
}
const px25 = (r, g, b, a = 255) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; };
async function loadBake25() {
  const tL = performance.now(), steps = {}, mark = (k) => { steps[k] = Math.round(performance.now() - tL); };
  let main = 0, m0 = performance.now();
  const key = bakeKey25(TREE_FORMS, TV25_POOLS, 'a' + ATLAS.VERSION + '|t' + T25.ALPHA);
  main += performance.now() - m0;
  // started at page load by furnitureKit.js (TV25_BAKE); a late fallback fetch only if that is missing
  const J = TV25_BAKE ? await TV25_BAKE.json : await (await fetch(BAKE25 + 'trees25.json', { priority: 'high' })).json();
  if (!J) throw new Error('trees25.json unavailable');
  mark('json');
  if (J.key !== key) throw new Error(`stale bake (key ${J.key}, forms/generator ${key})`);
  if (J.version !== 4) throw new Error('bake format v' + J.version);
  // ONE bundle: geometry, the atlas mip chain (gzip raw RGBA) and the bark JPGs
  const bin = TV25_BAKE ? await TV25_BAKE.bin : await fetch(BAKE25 + 'trees25.bin', { priority: 'high' }).then((r) => { if (!r.ok) throw new Error('trees25.bin HTTP ' + r.status); return r.arrayBuffer(); });
  if (!bin) throw new Error('trees25.bin unavailable');
  mark('bin');
  // ---- the atlas: no image decoder (they are queued behind the whole boot's textures: 62 s measured) — inflate the raw
  // chain in a worker and upload it as a DataTexture, the path furnitureKit's alphaMipTexture takes at runtime
  const [go, gn] = J.atlas.gz;
  const rawBuf = await gunzip25(() => bin.slice(go, go + gn));
  mark('atlasInflated');
  m0 = performance.now();
  const atlas = alphaMipDataTexture(J.atlas.raw.map(([o, w, h]) => ({ data: new Uint8Array(rawBuf, o, w * h * 4), width: w, height: h })), { anisotropy: 8 });
  // ---- bark: JPGs, decoded whenever the image decoders get to them. The materials start on 1x1 placeholders (a mean
  // bark colour and a flat normal — same defines, so the swap is not a recompile) and take the real maps when ready.
  const raw = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const blob = ([o, n, type]) => new Blob([new Uint8Array(bin, o, n)], { type });
  const barkTex = {};
  for (const [k, [, , ns]] of Object.entries(J.bark)) barkTex[k] = { map: px25(104, 96, 86), normal: px25(128, 128, 255), ns };
  for (const B of Object.values(barkTex)) B.map.colorSpace = THREE.SRGBColorSpace;
  const barkReady = Promise.all(Object.entries(J.bark).map(async ([k, [c, n, ns]]) => {
    const [bc, bn] = await Promise.all([createImageBitmap(blob(c), { imageOrientation: 'flipY' }), createImageBitmap(blob(n), { ...raw, imageOrientation: 'flipY' })]);
    return [k, { map: texFromBitmap25(bc, true), normal: texFromBitmap25(bn, false), ns }];
  })).then((b) => { mark('bark'); return Object.fromEntries(b); });
  const geos = new Map();
  let trisT = 0, tris0 = 0, tris1 = 0;
  for (const [base, P] of Object.entries(J.pools)) {
    geos.set(base, { trunk0: geoFromBake25(bin, P.trunk0), leaves0: geoFromBake25(bin, P.leaves0), leaves1: geoFromBake25(bin, P.leaves1), bark: P.bark, stats: P.stats });
    trisT += P.stats.trunkTris; tris0 += P.stats.leafTris0; tris1 += P.stats.leafTris1;
  }
  main += performance.now() - m0;
  mark('geometry');
  return { geos, atlas, barkTex, barkReady, stats: { trisT, tris0, tris1, bytes: bin.byteLength }, main, steps };
}
async function generate25() {
  let main = 0;
  const { Tree } = await import('@dgreenheck/ez-tree');
  let m0 = performance.now();
  // ez-tree keeps its textures in a module registry; a throwaway trunk per type hands them over
  const ezTex = (barkType, leafType) => {
    const t = new Tree();
    t.options.bark.type = barkType; t.options.leaves.type = leafType; t.options.branch.levels = 0; t.options.leaves.count = 0;
    t.generate();
    const out = { color: t.branchesMesh.material.map, normal: t.branchesMesh.material.normalMap, leaf: t.leavesMesh.material.map };
    t.branchesMesh.geometry.dispose(); t.leavesMesh.geometry.dispose();
    return out;
  };
  const ez = { oak: ezTex('oak', 'oak'), willow: ezTex('willow', 'ash'), birch: ezTex('birch', 'aspen') };
  main += performance.now() - m0;
  const [oakLeaf, ashLeaf, aspenLeaf, oakC, oakN, wilC, wilN, birC, birN] = await Promise.all([
    ez.oak.leaf, ez.willow.leaf, ez.birch.leaf, ez.oak.color, ez.oak.normal, ez.willow.color, ez.willow.normal, ez.birch.color, ez.birch.normal,
  ].map(texImage25));
  m0 = performance.now();
  const atlasCanvas = paintLeafAtlas25({ oak: oakLeaf, ash: ashLeaf, aspen: aspenLeaf });
  // (debug handle for the tree lab's per-cell coverage census only: the 16 MB canvas is not kept otherwise)
  if (typeof window !== 'undefined' && /(^|[?&])tv25dbg=1/.test(location.search)) window.__TREE25_ATLAS = atlasCanvas;
  const atlas = alphaMipTexture(atlasCanvas, T25.ALPHA, { name: 'leafAtlas25', cells: T25.NC, anisotropy: 8 });
  const barkTex = {
    oak: { map: wrapTex25(oakC, true), normal: wrapTex25(oakN, false), ns: 1.0 },
    willow: { map: wrapTex25(wilC, true), normal: wrapTex25(wilN, false), ns: 1.0 },
    birch: { map: wrapTex25(birC, true), normal: wrapTex25(birN, false), ns: 0.8 },
    plane: { map: canvasTex25(planeCamoCanvas25()), normal: wrapTex25(birN, false), ns: 0.35 },
  };
  main += performance.now() - m0;
  const geos = new Map();
  let trisT = 0, tris0 = 0, tris1 = 0;
  for (const base of TV25_POOLS) {
    const S = tv25Spec(base);
    if (!S) continue;
    m0 = performance.now();
    try {
      const r = buildTree(S.F, S.H, S.W, S.seed, { cellUV: cellUV25, barkCell: LEAF_CELLS.bark });
      geos.set(base, { trunk0: r.trunk0, leaves0: r.leaves0, leaves1: r.leaves1, bark: S.F.bark || 'oak', stats: r.stats });
      trisT += r.stats.trunkTris; tris0 += r.stats.leafTris0; tris1 += r.stats.leafTris1;
    } catch (e) { console.warn('[trees25] failed', base, e); }
    main += performance.now() - m0;
    await sleep(0);   // one form per task: no long main-thread stall while the city streams
  }
  return { geos, atlas, barkTex, stats: { trisT, tris0, tris1 }, main };
}

// ---- TR36 (above): the bake, the crown and bark materials, the pool swap
// TR38 (bake format v3, a split bundle: tools/ar35/trees/bake36.mjs): the geometry is trees36.bin, one gzip member of
// treeGeo38.js streams (u16 positions over each stream's box, delta-coded, bytes in planes), inflated and decoded in a worker;
// the two leaf atlases are KTX2 (UASTC, their own mip chains; the app's one KTX2Loader); the bark stays JPEG, one file a map.
const GEO38_WORKER = `const geo38Decode = ${geo38Decode.toString()};
onmessage = async (e) => {
  try {
    const raw = await new Response(new Blob([e.data.gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const out = geo38Decode(raw, e.data.streams);
    postMessage(out, out.map((a) => a.buffer));
  } catch (err) { postMessage({ error: String((err && err.message) || err) }); }
};`;
function decodeGeo38(gz, streams) {
  const main = async () => geo38Decode(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(), streams);
  try {
    const url = URL.createObjectURL(new Blob([GEO38_WORKER], { type: 'text/javascript' }));
    const w = new Worker(url);
    return new Promise((res, rej) => {
      const done = () => { w.terminate(); URL.revokeObjectURL(url); };
      w.onmessage = (e) => { done(); if (Array.isArray(e.data)) res(e.data); else rej(new Error('geo38 worker: ' + (e.data?.error || 'no data'))); };
      w.onerror = () => { done(); main().then(res, rej); };
      w.postMessage({ gz, streams });   // (copied, not transferred: the main-thread fallback still has it)
    });
  } catch (e) { return main(); }
}
function geoFromBake38(arrs, G) {
  const g = new THREE.BufferGeometry();
  for (const [name, [s, , size, codec, norm]] of Object.entries(G.attrs)) {
    g.setAttribute(name, codec === 'f16' ? new THREE.Float16BufferAttribute(arrs[s], size) : new THREE.BufferAttribute(arrs[s], size, !!norm));
  }
  g.setIndex(new THREE.BufferAttribute(arrs[G.index[0]], 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
// a KTX2 leaf atlas with the sampler the raw-RGBA DataTexture had (furnitureKit alphaMipDataTexture)
const ktx38 = (L, buf, srgb) => new Promise((res, rej) => L.parse(buf, (t) => {
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8; t.needsUpdate = true;
  res(t);
}, rej));
async function loadBake36(instancer) {
  const J = await TR36_FETCH.json;
  if (!J) throw new Error('trees36.json unavailable');
  if ((J.version | 0) !== 3) throw new Error('bake format v' + J.version + ' (TR38 reads v3: the split bundle)');
  const forms36 = Object.fromEntries(Object.keys(TR36_FORMS).map((id) => [id, TREE_FORMS[id]]));
  const pools36 = TV25_POOLS.filter((b) => TR36_FORMS[b.slice(4).replace(/\d+$/, '')]);
  const key = bakeKey25(forms36, pools36, 'tr36v' + TREE36_VERSION + '|' + JSON.stringify(TR36_FORMS) + '|t' + T25.ALPHA);
  if (J.key !== key) throw new Error(`stale bake (key ${J.key}, forms/generator ${key})`);
  const [gz, colBuf, nrmBuf] = await Promise.all([TR36_FETCH.bin, TR36_FETCH.leafCol, TR36_FETCH.leafNrm]);
  if (!gz) throw new Error('trees36.bin unavailable');
  if (gz.byteLength !== J.geo.gzBytes) throw new Error(`trees36.bin is ${gz.byteLength} bytes, the index says ${J.geo.gzBytes} (a bake in progress)`);
  if (!colBuf || !nrmBuf) throw new Error('leaf_col.ktx2 / leaf_nrm.ktx2 unavailable');
  const L = ktx2Loader(instancer?.engine?.renderer);
  if (!L) throw new Error('no KTX2 loader (renderer unknown)');
  let bytes = gz.byteLength + colBuf.byteLength + nrmBuf.byteLength;
  const arrsP = decodeGeo38(gz, J.geo.streams);
  const [atlas, normal] = await Promise.all([ktx38(L, colBuf, true), ktx38(L, nrmBuf, false)]);
  const raw = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const img = (n, o) => fetch(BAKE36 + n).then((r) => { if (!r.ok) throw new Error(n + ' HTTP ' + r.status); return r.blob(); }).then((b) => { bytes += b.size; return createImageBitmap(b, o); });
  const bark = {};
  // (TR37: every species' bark; the normal map's blue channel is the scan's height; `rep` keeps the scan's aspect along the trunk)
  await Promise.all(Object.entries(J.bark).map(async ([f, [c, n, rep]]) => {
    const [bc, bn] = await Promise.all([img(c, { imageOrientation: 'flipY' }), img(n, { ...raw, imageOrientation: 'flipY' })]);
    const map = texFromBitmap25(bc, true), normal = texFromBitmap25(bn, false);
    for (const t of [map, normal]) t.repeat.set(1, rep ?? 1);
    bark[f] = { map, normal, height: rep != null };
  }));
  const arrs = await arrsP;
  if (arrs.length !== J.geo.streams.length) throw new Error('geo38: stream count');
  const geos = new Map();
  let trisT = 0, tris0 = 0, tris1 = 0;
  for (const [base, P] of Object.entries(J.pools)) {
    geos.set(base, { form: P.form, trunk0: geoFromBake38(arrs, P.trunk0), trunkS: P.trunkS ? geoFromBake38(arrs, P.trunkS) : null, leaves0: geoFromBake38(arrs, P.leaves0), leaves1: geoFromBake38(arrs, P.leaves1), leaves2: P.leaves2 ? geoFromBake38(arrs, P.leaves2) : null, stats: P.stats });
    trisT += P.stats.trunkTris; tris0 += P.stats.leafTris0; tris1 += P.stats.leafTris1;
  }
  // (the TR36 atlas's swatch in uv: the generator's uvOf1('swatch'), the atlas rows top-down in the PNG)
  const A = J.size || 2048, sw = J.swatch;
  const swatchRect = sw ? [sw[0] / A, 1 - (sw[1] + sw[3]) / A, (sw[0] + sw[2]) / A, 1 - sw[1] / A] : null;
  return { geos, atlas, normal, bark, barkMean: J.barkMean || null, swatchMean: J.swatchMean || null, swatchRect, px38: 0, stats: { trisT, tris0, tris1, bytes } };
}
// the TR36 crown: the shared crown program's whole chain (instancer.js wind + alpha ramp, snow, city AO, edge fade, TV25 /
// TC26 / TR34 / TR35 shading) on a material of its own (the TR36 atlas and leaf normals), plus TR36's own terms
// fade: TR37 LOD level of a cross-fade (0 LOD0, 1 LOD1, 2 LOD2; -1 none)
function makeCrown36(base, atlas, normal, park, fade = -1) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: base.roughness, metalness: 0, map: atlas, normalMap: normal,
    alphaTest: base.alphaTest, side: THREE.DoubleSide, alphaToCoverage: base.alphaToCoverage,
  });
  m.shadowSide = THREE.DoubleSide;
  m.color.setRGB(CROWN38[0], CROWN38[1], CROWN38[2]);
  m.defines = { ...(base.defines || {}), TR36_CROWN: '', ...(fade >= 0 ? { FADE37: String(fade) } : {}) };
  const uPark = { value: new THREE.Vector3(...park) };
  m.onBeforeCompile = (sh, r) => {
    base.onBeforeCompile.call(base, sh, r);
    sh.uniforms.uLeaf36 = LEAF36; sh.uniforms.uLeaf36b = LEAF36B; sh.uniforms.uPark36 = uPark; sh.uniforms.uLod37 = LOD37;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWind; uniform vec4 uLod37; varying vec2 vFade37;')
      .replace('#include <project_vertex>', WIND36(false) + `#ifdef FADE37
{
  // TR37: this instance's share of the pixels in a cross-fade band, from its distance (as the instancer measures it: horizontal)
  #ifdef USE_INSTANCING
    vec3 o37 = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
  #else
    vec3 o37 = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  #endif
  float d37 = length( o37.xz - cameraPosition.xz );
  float s01 = smoothstep( uLod37.x - uLod37.y, uLod37.x + uLod37.y, d37 ), s12 = smoothstep( uLod37.z - uLod37.w, uLod37.z + uLod37.w, d37 );
  #if FADE37 == 0
    vFade37 = vec2( 0.0, 1.0 - s01 );
  #elif FADE37 == 1
    vFade37 = vec2( 1.0 - s01, 1.0 - s12 );
  #else
    vFade37 = vec2( 1.0 - s12, 2.0 );
  #endif
}
#endif
#include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uLeaf36; uniform vec4 uLeaf36b; uniform vec3 uPark36; float trans36 = 1.0; varying vec2 vFade37;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#ifdef FADE37
{
  float h37 = fract( 52.9829189 * fract( dot( gl_FragCoord.xy + vec2( 3.31, 7.93 ) * uDith34 * 1.618, vec2( 0.06711056, 0.00583715 ) ) ) );
  if ( h37 < vFade37.x || h37 >= vFade37.y ) discard;
}
#endif`)
      // transmitted skylight (after the TC26 balance: not multiplied by the canopy's scattering gain)
      .replace('reflectedLight.directSpecular *= uLeafBal.x;', `reflectedLight.directSpecular *= uLeafBal.x;
      reflectedLight.directDiffuse *= uLeaf36b.z;
      {
        vec3 up36 = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
        vec3 irr36 = getLightProbeIrradiance( lightProbe, up36 );
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          irr36 += getIBLIrradiance( up36 );
        #endif
        float under36 = smoothstep( 0.35, -0.6, dot( normal, up36 ) );
        reflectedLight.indirectDiffuse += irr36 * BRDF_Lambert( material.diffuseContribution ) * trans36 * under36 * vAO25 * uLeaf36b.x * ( 1.0 - uLeafNight );
      }`)
      // outside the TR35 boxes the species' trees25 park colour (the atlas is calibrated to the street cells)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= ${TR35 ? 'mix( uPark36, vec3( 1.0 ), vStreet35 )' : 'uPark36'};`)
      // the leaf relief: the scanned leaflet normal in the CARD's frame, added to the crown-volume normal as its deviation
      // from the flat card (the volume shading holds; each leaflet catches the light on its own); its alpha -> trans36
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP
{
  vec4 nt36 = texture2D( normalMap, vNormalMapUv );
  trans36 = nt36.a;
  vec3 mapN36 = nt36.xyz * 2.0 - 1.0;
  mapN36.xy *= normalScale * uLeaf36.x;
  ${TC26 ? 'vec3 fc36 = length( vFace26 ) > 0.5 ? vFace26 * ( dot( vFace26, vViewPosition ) < 0.0 ? -1.0 : 1.0 ) : normal;' : 'vec3 fc36 = normal;'}
  mat3 tb36 = getTangentFrame( - vViewPosition, fc36, vNormalMapUv );
  #ifdef DOUBLE_SIDED
    tb36[0] *= faceDirection; tb36[1] *= faceDirection;
  #endif
  vec3 nm36 = tb36 * mapN36;
  vec3 nl36 = dot( nm36, nm36 ) > 1e-8 ? normalize( nm36 ) : fc36;
  vec3 nn36 = normal + ( nl36 - fc36 );
  normal = dot( nn36, nn36 ) > 1e-6 ? normalize( nn36 ) : normal;
}
#endif`)
      // the firefly ceiling (LEAF36B.y)
      .replace('#include <opaque_fragment>', 'outgoingLight = min( outgoingLight, vec3( uLeaf36b.y ) );\n#include <opaque_fragment>')
      // translucency: the blade passes light, veins, rachis and twigs much less
      .replaceAll('( 0.3 * away + back )', '( mix( 0.3, uLeaf36.w, trans36 ) * away + back )')
      .replaceAll('uLeafLight.x * RECIPROCAL_PI', 'uLeafLight.x * mix( uLeaf36.y, uLeaf36.z, trans36 ) * RECIPROCAL_PI');
  };
  m.customProgramCacheKey = () => (base.customProgramCacheKey ? base.customProgramCacheKey() : '') + '|tr36' + (fade >= 0 ? '|f37' + fade : '');
  return m;
}
// TR37: the far pool's split, after every cull (see LOD37): the instancer wrote LOD0 (mesh) and LOD1 (mesh2) for each pool it
// re-compacted this frame; the LOD1 instances past the far band move to the far mesh, and the instances inside a band are
// written to both of its levels
function split37(far, instancer, camera) {
  if (!camera) return;
  const cx = camera.position.x, cz = camera.position.z, L = LOD37.value;
  const a0 = L.x - L.y, a1 = L.x + L.y, b0 = L.z - L.w, b1 = L.z + L.w;
  const show = (m, k) => { if (k > 0) { m.visible = true; if (m.userData) m.userData.dcHid = false; } };
  const touch = (m, k) => {
    const im = m.instanceMatrix; im.clearUpdateRanges(); im.addUpdateRange(0, k * 16); im.needsUpdate = true;
    const ic = m.instanceColor; if (ic) { ic.clearUpdateRanges(); ic.addUpdateRange(0, k * 3); ic.needsUpdate = true; }
  };
  for (const F of far) {
    const p = F.p, m1 = p.mesh, m2 = p.mesh2, mf = F.mesh;
    if (!m2 || !p.n) { if (mf.count) { mf.count = 0; mf.visible = false; } continue; }
    if (m1.instanceMatrix === F.a1 && m1.instanceMatrix.version === F.v1 && m2.instanceMatrix === F.a2 && m2.instanceMatrix.version === F.v2) continue;
    const k1 = m1.count, k2 = m2.count;
    const A2 = m2.instanceMatrix.array, C2 = m2.instanceColor.array;
    const toM1 = [], keep2 = [], toFar = [], toM2 = [];
    {
      const A1 = m1.instanceMatrix.array;
      for (let i = 0; i < k1; i++) { const o = i * 16; if (Math.hypot(A1[o + 12] - cx, A1[o + 14] - cz) > a0) toM2.push(i); }
    }
    for (let i = 0; i < k2; i++) {
      const o = i * 16, d = Math.hypot(A2[o + 12] - cx, A2[o + 14] - cz);
      if (d < a1) toM1.push(i);
      if (d < b1) keep2.push(i);
      if (d > b0) toFar.push(i);
    }
    // the far mesh, from the LOD1 set as the instancer wrote it
    if (toFar.length > mf.instanceMatrix.count) instancer._growMesh(mf, toFar.length, true);
    {
      const AF = mf.instanceMatrix.array, CF = mf.instanceColor.array;
      for (let j = 0; j < toFar.length; j++) { const i = toFar[j]; AF.set(A2.subarray(i * 16, i * 16 + 16), j * 16); CF[j * 3] = C2[i * 3]; CF[j * 3 + 1] = C2[i * 3 + 1]; CF[j * 3 + 2] = C2[i * 3 + 2]; }
      mf.count = toFar.length; mf.visible = toFar.length > 0; touch(mf, toFar.length);
    }
    // LOD0 also draws the LOD1 instances inside the near band
    if (k1 + toM1.length > m1.instanceMatrix.count) instancer._growMesh(m1, k1 + toM1.length, true);
    {
      const A1 = m1.instanceMatrix.array, C1 = m1.instanceColor.array;
      for (let j = 0; j < toM1.length; j++) { const i = toM1[j], o = k1 + j; A1.set(A2.subarray(i * 16, i * 16 + 16), o * 16); C1[o * 3] = C2[i * 3]; C1[o * 3 + 1] = C2[i * 3 + 1]; C1[o * 3 + 2] = C2[i * 3 + 2]; }
      m1.count = k1 + toM1.length; show(m1, m1.count); touch(m1, m1.count);
    }
    // LOD1: what is left inside the far band (compacted in place), then the LOD0 instances inside the near band
    const n2 = keep2.length + toM2.length;
    if (n2 > m2.instanceMatrix.count) instancer._growMesh(m2, n2, true);
    {
      const B2 = m2.instanceMatrix.array, D2 = m2.instanceColor.array, A1 = m1.instanceMatrix.array, C1 = m1.instanceColor.array;
      for (let j = 0; j < keep2.length; j++) { const i = keep2[j]; if (i !== j) { B2.copyWithin(j * 16, i * 16, i * 16 + 16); D2.copyWithin(j * 3, i * 3, i * 3 + 3); } }
      for (let j = 0; j < toM2.length; j++) { const i = toM2[j], o = keep2.length + j; B2.set(A1.subarray(i * 16, i * 16 + 16), o * 16); D2[o * 3] = C1[i * 3]; D2[o * 3 + 1] = C1[i * 3 + 1]; D2[o * 3 + 2] = C1[i * 3 + 2]; }
      m2.count = n2; m2.visible = n2 > 0; if (m2.userData) m2.userData.dcHid = n2 === 0; touch(m2, n2);
    }
    F.a1 = m1.instanceMatrix; F.v1 = m1.instanceMatrix.version; F.a2 = m2.instanceMatrix; F.v2 = m2.instanceMatrix.version;
    F.stats = { near: m1.count, lod1: m2.count, far: mf.count };
  }
}
// TR37 FAR POOL AND CROSS-FADES (session 2; the lead's 05:59 answer: trees.js may own its far pool, instancer.js stays as it
// is). At qc_lenox 2,600 trees past the 90 m swap drew 3.2 M of the trees' 4.0 M triangles, the TR36 forms' LOD1 2.8-3.8k
// each (tr37c, an in-page pool census). Past LOD37.z (150 m) a TR36 crown draws its LOD2 (treeGen.js: ~110-140 cards at the
// LOD0 card area + the trunk proxy, ~450-570 triangles) from a pool of this file's own, filled after the instancer's cull
// (instancer.cull is wrapped here, its code untouched): the instances of the LOD1 set past the band go to the far pool. Both
// swaps are dithered cross-fades: an instance within LOD37.y of the 90 m swap draws in LOD0 and LOD1, within LOD37.w of
// the far swap in LOD1 and LOD2, each keeping a complementary share of the pixels (an interleaved-gradient threshold that moves
// every frame, so TAA or the film's accumulation turns it into a fade); the share follows the instance's distance in the
// shader. The film (`filmlod=1`, every near tree at LOD0) is untouched. `?lod37=0` = session 1 (hard swap at 90 m, LOD1 to
// the horizon); `?lod2=<m>` moves the far swap.
const LODF37 = !(T25Q && T25Q.get('lod37') === '0') && T25.LOD < 1e3;
const LOD37 = { value: new THREE.Vector4(T25.LOD, 12, Number(T25Q?.get('lod2')) || 150, 20) };
// TR37 BARK RELIEF (session 2; the lead's 05:59 review: "flat bark"): parallax occlusion over the scan's height (the normal
// map's blue channel, build36.py), near the lens only: x the relief depth in texture units (a tile is ~0.9 m of bark round the
// trunk: 0.024 ~ 2 cm), y / z the distance (m) over which it fades out, w the most steps (fewer when seen square-on). The
// normal's z is rebuilt from x / y (three's USE_PACKED_NORMALMAP path). `?pom37=0` turns the relief off (the normal map stays).
const POM37 = { value: new THREE.Vector4(T25Q?.get('pom37') === '0' ? 0 : 0.024, 5.0, 16.0, 14.0) };
if (typeof window !== 'undefined') window.__TREE37 = { POM37, LOD37 };
function makeBark36(B, k, ns, cal) {
  const m = new THREE.MeshStandardMaterial({ map: B.map, normalMap: B.normal, roughness: 0.9, metalness: 0, vertexColors: true });
  m.color.setScalar(k);
  m.normalScale.set(ns, ns);
  applyLightTrim(applyCityAO(applySnowCap(m)), cal);
  if (B.height) m.defines = { ...(m.defines || {}), USE_PACKED_NORMALMAP: '', BARK37_POM: '' };
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.windT = ENV.windT; sh.uniforms.windAmp = ENV.windAmp;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windT; uniform float windAmp;')
      .replace('#include <project_vertex>', WIND36(true) + '#include <project_vertex>');
    if (!B.height) return;
    sh.uniforms.uPom37 = POM37;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uPom37;')
      .replace('#include <map_fragment>', `vec2 uvP37 = vMapUv;
#if defined( BARK37_POM ) && defined( USE_NORMALMAP ) && ! defined( USE_TANGENT )
{
  float k37 = uPom37.x * ( 1.0 - smoothstep( uPom37.y, uPom37.z, length( vViewPosition ) ) );
  vec3 n37 = normalize( vNormal );
  mat3 tb37 = getTangentFrame( - vViewPosition, n37, vMapUv );
  vec2 gx37 = dFdx( vMapUv ), gy37 = dFdy( vMapUv );
  if ( k37 > 1e-4 ) {
    vec3 v37 = normalize( vViewPosition );
    vec3 vt37 = vec3( dot( tb37[0], v37 ), dot( tb37[1], v37 ), dot( n37, v37 ) );
    float st37 = floor( mix( uPom37.w, 5.0, abs( vt37.z ) ) );
    vec2 dUV = - vt37.xy / max( abs( vt37.z ), 0.3 ) * k37 / st37;
    float dl = 1.0 / st37, layer = 0.0;
    vec2 uv = vMapUv, uvPrev = vMapUv;
    float dep = 1.0 - textureGrad( normalMap, uv, gx37, gy37 ).b, depPrev = dep, layPrev = 0.0;
    for ( int i = 0; i < 16; i ++ ) {
      if ( float( i ) >= st37 || layer >= dep ) break;
      uvPrev = uv; depPrev = dep; layPrev = layer;
      uv += dUV; layer += dl;
      dep = 1.0 - textureGrad( normalMap, uv, gx37, gy37 ).b;
    }
    float a37 = dep - layer, b37 = depPrev - layPrev;
    uvP37 = mix( uv, uvPrev, clamp( a37 / min( a37 - b37, -1e-5 ), 0.0, 1.0 ) );
  }
}
#endif
#ifdef USE_MAP
  diffuseColor *= texture2D( map, uvP37 );
#endif`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', 'texture2D( normalMap, uvP37 )'));
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|tr36bark' + (B.height ? '|pom37' : '');
  return m;
}
// bark colour (x the map; the vertex tint and AO are the generator's, as in trees25): bark_willow_02 is trees25's own willow
// than trees25's: s317 27 against 39-45); Bark001 (grey, 0.223 luminance) to the trees25 oak map x 0.45 x 0.8 (0.039)
const BARK36 = { H: [0.34, 2.2], S: [0.18, 2.0] };   // (normal x2.2 / x2.0: in the canopy's shade the trunk is lit by the sky only, and at x1.6 it read as a smooth tube: tr36b hero_sun)
// TR37: every species from its own scan (tools/ar35/trees/build36.py barkMeans) with the relief; the albedo factor puts the bark's
// effective linear luma (scan mean x the form's baked tint x this) near: plane 0.13 (pale camouflage plates), zelkova 0.05,
// cherry 0.05, oak 0.05, maple 0.05 (honeylocust 0.07 and sophora 0.03 as TR36 had them). The normal gain is 1.4: x2.2 / x2.0
// above made up for bark drawn inside out (TR37: the far wall's normals), which the relief and the outward winding now carry.
const BARK37 = { H: [0.34, 1.4], S: [0.18, 1.4], P: [0.43, 1.3], Z: [0.3, 1.4], Y: [1.0, 1.4], Q: [0.71, 1.4], M: [1.43, 1.4] };   // (Z 0.47 -> 0.3: the zelkova trunk read orange in tr37f)
// the trees25 forms' bark from the TR37 scans (their geometry and leaves stay trees25): form -> scan
const BARK37_FORM = { P: 'P', Z: 'Z', Y: 'Y', X: 'Y', W: 'Y', Q: 'Q', M: 'M', R: 'S', L: 'S', G: 'S' };
const TR37B = !(T25Q && T25Q.get('tr37b') === '0');
// TR38: the far trunk stand-ins (LOD1 / LOD2's crossed quads in an atlas's bark swatch) take the colour of the scanned bark the
// near trunk wears, per vertex: the trunk's albedo through its day trim (makeBark36: BARK37 k x the scan's mean x the street
// calibration) over the swatch's through the crown's (LEAF25.gain). trees25's swatch is the painted sRGB (74, 66, 58); the TR36
// atlas's is measured by the bake (swatchMean). Before, every stand-in kept its atlas's bark (a colour step at the 90 m swap:
// a cherry's sakura bark against a dark grey-brown card). `?px38=0` keeps the swatches as they were.
const PX38 = !(T25Q && T25Q.get('px38') === '0');
const SWATCH25 = [74, 66, 58].map((c) => ((c / 255 + 0.055) / 1.055) ** 2.4);
function tintProxy38(geo, rect, key, J, swatch, cal) {
  const m = J.barkMean?.[key], k = BARK37[key]?.[0];
  if (!geo || !m || k == null || !swatch) return 0;
  const g = LEAF25.gain.value, gq = [g.x, g.y, g.z];
  const c = [0, 1, 2].map((q) => Math.min(4, Math.max(0.15, (k * m[q] * cal[q]) / Math.max(1e-4, swatch[q] * gq[q]))));
  const uv = geo.getAttribute('uv'), col = geo.getAttribute('color');
  if (!uv || !col) return 0;
  const [u0, v0, u1, v1] = rect, e = 2e-3;
  let n = 0;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (u >= u0 - e && u <= u1 + e && v >= v0 - e && v <= v1 + e) { col.setXYZ(i, c[0], c[1], c[2]); n++; }
  }
  if (n) col.needsUpdate = true;
  return n;
}   // `?tr37b=0`: the trees25 forms keep their trees25 bark
const FAR37 = [];   // the far pool (LOD37): [{ p: the crown pool, mesh: its LOD2 InstancedMesh, ... }]
if (typeof window !== 'undefined') window.__FAR37 = () => FAR37.map((F) => ({ pool: F.p.name, ...(F.stats || {}), tris2: F.mesh.geometry.index.count / 3 }));
async function applyTR36(instancer, cal) {
  const T = await loadBake36(instancer);
  const crown = {}, bark = {}, crown1 = {}, crown2 = {};
  const far37 = LODF37 && T.geos.size > 0 && [...T.geos.values()].every((G) => G.leaves2);   // (a pool without LOD2 would fade its LOD1 out to nothing)
  for (const f of Object.keys(T.bark)) {
    if (TR36_FORMS[f]) crown[f] = makeCrown36(instancer.crownMat, T.atlas, T.normal, PARK36[f] || [1, 1, 1], far37 ? 0 : -1);
    if (TR36_FORMS[f] && far37) { crown1[f] = makeCrown36(instancer.crownMat, T.atlas, T.normal, PARK36[f] || [1, 1, 1], 1); crown2[f] = makeCrown36(instancer.crownMat, T.atlas, T.normal, PARK36[f] || [1, 1, 1], 2); }
    bark[f] = makeBark36(T.bark[f], ...((T.bark[f].height ? BARK37[f] : BARK36[f]) || [0.3, 1.5]), cal);
  }
  let n = 0;
  for (const [base, G] of T.geos) {
    const pT = instancer.pools.get(base + 'Trunk'), pC = instancer.pools.get(base + 'Crown');
    if (!pT || !pC || !crown[G.form]) continue;
    pT.mesh.geometry = G.trunk0; pT.mesh.material = bark[G.form];
    pC.mesh.geometry = G.leaves0; pC.mesh.material = crown[G.form];
    instancer.setLOD(base + 'Crown', G.leaves1, T25.LOD);
    // LIGHTER SHADOW CASTERS: the near shadow pass drew every TR36 crown at LOD0 once more per cascade (tr36b: hero_sun +10.7 M
    // triangles against trees25, a near tree being ~47k). Its leaflets are finer than a shadow-map texel, so the casters are
    // the crown's LOD1 cards (same cells and coverage, ~1.4k triangles) and the bark without its twigs. instancer.js copies
    // the main geometry to the shadow set when it changes (_sync), so sync first, then override.
    // The film (`filmlod=1`, offline, every near tree at LOD0) keeps the LOD0 crown as its caster: with LOD1 casters the
    // golden Mall frame went darker (frame luma 65.6 in two runs against 69.8, cp_tr36_v6 / cp_tr36_f), shadows denser than
    // the crowns that cast them.
    if (PX38 && T.swatchRect) for (const g of [G.leaves1, G.leaves2]) T.px38 += tintProxy38(g, T.swatchRect, G.form, T, T.swatchMean, cal);
    if (instancer._sync) { instancer._sync(pT); instancer._sync(pC); }
    if (pC.shadow && T25.LOD < 1e3) pC.shadow.geometry = G.leaves1;
    if (pT.shadow && G.trunkS) pT.shadow.geometry = G.trunkS;
    // TR37: LOD1 fades in and out (its own variant of the crown program), LOD2 in a far mesh of this file's own
    if (far37 && G.leaves2 && pC.mesh2) {
      pC.mesh2.material = crown1[G.form];
      // the casters past the LOD swap inside the near cascade (the instancer's shadow2 set) take LOD2: they cast 0.3-1.0 M
      // triangles with LOD1 against trees25's 0.1-0.25 M (tr37g)
      if (pC.shadow2) pC.shadow2.geometry = G.leaves2;
      const cap = 1024, mf = new THREE.InstancedMesh(G.leaves2, crown2[G.form], cap);
      mf.name = 'pool:' + base + 'Crown:far37';
      mf.count = 0; mf.frustumCulled = false; mf.castShadow = false; mf.receiveShadow = true; mf.matrixAutoUpdate = false; mf.visible = false;
      mf.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mf.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      mf.instanceColor.setUsage(THREE.DynamicDrawUsage);
      instancer.scene.add(mf);
      FAR37.push({ p: pC, mesh: mf, a1: null, v1: -1, a2: null, v2: -1, stats: null });
    }
    n++;
  }
  if (FAR37.length && !instancer.__far37) {
    const cull0 = instancer.cull.bind(instancer);
    // (a failure here must never take the frame loop with it: the far pool switches itself off, the LOD sets are re-compacted)
    instancer.cull = (camera = instancer.engine?.camera) => {
      cull0(camera);
      if (!FAR37.length) return;
      try { split37(FAR37, instancer, camera); } catch (e) {
        console.warn('[trees37] far pool off (split failed)', e);
        for (const F of FAR37) { F.mesh.visible = false; F.mesh.count = 0; F.p.dirty = true; }
        FAR37.length = 0;
        LOD37.value.z = 1e9;   // (LOD1 keeps every far tree again: its program fades out toward LOD37.z)
      }
    };
    instancer.__far37 = true;
  }
  // TR37: the other forms' trunks take their species' scanned bark with the relief (plane, zelkova / elm, cherry, oak, maple ...)
  let nb = 0;
  if (TR37B) for (const base of TV25_POOLS) {
    if (T.geos.has(base)) continue;
    const key = BARK37_FORM[base.slice(4).replace(/\d+$/, '')], pT = instancer.pools.get(base + 'Trunk');
    if (!key || !bark[key] || !pT) continue;
    pT.mesh.material = bark[key];
    if (instancer._sync) instancer._sync(pT);
    if (PX38) { const pC = instancer.pools.get(base + 'Crown'); if (pC?.mesh2) T.px38 += tintProxy38(pC.mesh2.geometry, cellUV25(LEAF_CELLS.bark, false), key, T, SWATCH25, cal); }
    nb++;
  }
  return { n, nb, px38: T.px38, stats: T.stats };
}

// UE14 (2026-10-09, the owner: "Central Park: the tree leaves look rather low quality and have a lot of pop-in"; notes in
// docs/notes/ar34-ue13.md). The trees25 forms (most of the park: elm, oak, maple, plane, zelkova, cherry ...) swapped their
// crown from LOD0 to LOD1 at the 90 m LOD in one frame, and every form's trunk (TR36's too) vanished there, its far stand-in
// being LOD1's bark quads. Both now cross-fade over TR37's band (LOD37.x +- LOD37.y) with TR37's dither: LOD0's crown and
// trunk hand their pixels to LOD1's crown as the distance grows, an instance inside the band drawn at both levels.
// `?fade14=0` restores the hard swap; the film (`filmlod=1`, no swap inside its range) is untouched.
const FADE14 = !(T25Q && /^(0|flora)$/.test(T25Q.get('fade14') || '')) && T25.LOD < 1e3;   // (`fade14=flora`: cpFloraKit's fades only)
const BAND14 = [];   // { p: the pool, two: LOD0's band instances also go to LOD1 (a crown; a trunk's LOD1 draws nothing) }
const VAR14 = new Map();
// a material's cross-fade level: level 0 keeps a pixel while the dither is under 1 - s, level 1 from there on (s: smoothstep
// across the band), so the two levels share each pixel of an instance exactly once
function fade14(base, level) {
  const key = base.uuid + ':' + level;
  if (VAR14.has(key)) return VAR14.get(key);
  const m = base.clone();
  // the maps follow the base (the bark scans land after the trees are up and are swapped into the base)
  for (const k of ['map', 'normalMap']) Object.defineProperty(m, k, { get: () => base[k], set: () => {}, configurable: true });
  m.shadowSide = base.shadowSide;
  m.defines = { ...(base.defines || {}), FADE14: String(level) };
  m.onBeforeCompile = (sh, r) => {
    base.onBeforeCompile.call(base, sh, r);
    sh.uniforms.uLod14 = LOD37; sh.uniforms.uDith14 = DITH34;
    if (!sh.vertexShader.includes('#include <begin_vertex>') || !sh.fragmentShader.includes('#include <clipping_planes_fragment>')) console.warn('[ue14] no fade hook in', base.name || base.type);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uLod14; varying float vFade14;')
      .replace('#include <begin_vertex>', `{
  #ifdef USE_INSTANCING
    vec3 o14 = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
  #else
    vec3 o14 = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  #endif
  vFade14 = 1.0 - smoothstep( uLod14.x - uLod14.y, uLod14.x + uLod14.y, length( o14.xz - cameraPosition.xz ) );
}
#include <begin_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDith14; varying float vFade14;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  float h14 = fract( 52.9829189 * fract( dot( gl_FragCoord.xy + vec2( 3.31, 7.93 ) * uDith14 * 1.618, vec2( 0.06711056, 0.00583715 ) ) ) );
  #if FADE14 == 0
    if ( h14 >= vFade14 ) discard;
  #else
    if ( h14 < vFade14 ) discard;
  #endif
}`);
  };
  m.customProgramCacheKey = () => (base.customProgramCacheKey ? base.customProgramCacheKey() : '') + '|f14' + level;
  VAR14.set(key, m);
  return m;
}
// append src's instances `idx` to dst (as split37 does)
function append14(instancer, src, idx, dst) {
  if (!idx.length) return;
  const k = dst.count, n = k + idx.length, wc = !!(src.instanceColor && dst.instanceColor);
  if (n > dst.instanceMatrix.count) instancer._growMesh(dst, n, !!dst.instanceColor);
  const S = src.instanceMatrix.array, D = dst.instanceMatrix.array, SC = wc ? src.instanceColor.array : null, DC = wc ? dst.instanceColor.array : null;
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j], o = k + j;
    D.set(S.subarray(i * 16, i * 16 + 16), o * 16);
    if (wc) { DC[o * 3] = SC[i * 3]; DC[o * 3 + 1] = SC[i * 3 + 1]; DC[o * 3 + 2] = SC[i * 3 + 2]; }
  }
  dst.count = n; dst.visible = true; if (dst.userData) dst.userData.dcHid = false;
  const im = dst.instanceMatrix; im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
  if (wc) { const ic = dst.instanceColor; ic.clearUpdateRanges(); ic.addUpdateRange(0, n * 3); ic.needsUpdate = true; }
}
// after every cull: the instances inside the band, written to both levels (a pool the instancer did not re-compact is left)
function split14(instancer, camera) {
  if (!camera) return;
  const cx = camera.position.x, cz = camera.position.z, L = LOD37.value, a0 = L.x - L.y, a1 = L.x + L.y;
  for (const B of BAND14) {
    const p = B.p, m1 = p.mesh, m2 = p.mesh2;
    if (!m2 || !p.n) continue;
    if (m1.instanceMatrix === B.a1 && m1.instanceMatrix.version === B.v1 && m2.instanceMatrix === B.a2 && m2.instanceMatrix.version === B.v2) continue;
    const A1 = m1.instanceMatrix.array, A2 = m2.instanceMatrix.array, toM1 = [], toM2 = [];
    for (let i = 0; i < m2.count; i++) { const o = i * 16; if (Math.hypot(A2[o + 12] - cx, A2[o + 14] - cz) < a1) toM1.push(i); }
    if (B.two) for (let i = 0; i < m1.count; i++) { const o = i * 16; if (Math.hypot(A1[o + 12] - cx, A1[o + 14] - cz) > a0) toM2.push(i); }
    const k1 = m1.count;
    append14(instancer, m2, toM1, m1);
    if (B.two && toM2.length) { append14(instancer, m1, toM2, m2); }
    B.a1 = m1.instanceMatrix; B.v1 = m1.instanceMatrix.version; B.a2 = m2.instanceMatrix; B.v2 = m2.instanceMatrix.version;
    B.n = [k1, toM1.length, toM2.length];
  }
}
function applyFade14(instancer, geos) {
  let crowns = 0, trunks = 0;
  for (const base of geos.keys()) {
    const pT = instancer.pools.get(base + 'Trunk'), pC = instancer.pools.get(base + 'Crown');
    // (a TR36 crown has its own material and TR37's fades already)
    if (pC && pC.mesh2 && pC.mesh.material === instancer.crownMat && pC.mesh2.material === instancer.crownMat) {
      pC.mesh.material = fade14(instancer.crownMat, 0); pC.mesh2.material = fade14(instancer.crownMat, 1);
      BAND14.push({ p: pC, two: true, a1: null, v1: -1, a2: null, v2: -1 }); crowns++;
    }
    if (pT && pT.mesh2 && pT.mesh.material) {
      pT.mesh.material = fade14(pT.mesh.material, 0);
      BAND14.push({ p: pT, two: false, a1: null, v1: -1, a2: null, v2: -1 }); trunks++;
    }
  }
  if (BAND14.length && !instancer.__band14) {
    const cull0 = instancer.cull.bind(instancer);
    // (a failure here must never take the frame loop with it: the band switches itself off; the hard swap is back on the
    // next re-compaction, the variants then drawing past the band as the base levels do)
    instancer.cull = (camera = instancer.engine?.camera) => {
      cull0(camera);
      if (!BAND14.length) return;
      try { split14(instancer, camera); } catch (e) {
        console.warn('[ue14] cross-fade off', e);
        for (const B of BAND14) B.p.dirty = true;
        BAND14.length = 0; LOD37.value.y = 1e-3;
      }
    };
    instancer.__band14 = true;
  }
  if (typeof window !== 'undefined') window.__FADE14 = { BAND14, VAR14 };
  return { crowns, trunks };
}
// UE14: a sharper mip of the leaf atlas for every crown built on the shared crown program (trees25, TR36, cpFlora's elms,
// willows, shrubs and ferns): a negative LOD bias on the leaf colour and its cut, -0.6 (the Mall's canopy and the Lake's crowns
// crisper at mid range; recorded interactive takes t7Mall / t4Sheep: flicker max 8 % / 4 % as without it). `?leafbias14=<b>`
// sets it, `?leafbias14=0` = as before
const BIAS14 = (() => { const q = T25Q?.get('leafbias14'); return Math.max(-2, Math.min(0, q === null || q === undefined ? -0.6 : Number(q) || 0)); })();
// `?leafao14=<k>`: the baked crown AO on the canopy's fill light raised to k (deeper inside the crown; 1 = as before), the
// web's counterpart of the Unreal crowns' in-crown occlusion (a measurement switch)
const AO14 = Math.max(1, Math.min(4, Number(T25Q?.get('leafao14')) || 1));
function applyBias14(m) {
  if ((!BIAS14 && AO14 === 1) || m.__bias14) return false;
  m.__bias14 = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey, b = BIAS14.toFixed(2), k = AO14.toFixed(2);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    if (BIAS14) sh.fragmentShader = sh.fragmentShader.replace('texture2D( map, uv35 )', `texture2D( map, uv35, ${b} )`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP\n  diffuseColor *= texture2D( map, vMapUv, ${b} );\n#endif`);
    if (AO14 !== 1) sh.fragmentShader = sh.fragmentShader.replaceAll('mix(uLeafBal.w, 1.0, vAO25)', `mix(uLeafBal.w, 1.0, pow(vAO25, ${k}))`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|b14' + b + '|a14' + k;
  m.needsUpdate = true;
  return true;
}
// UE14 end

async function upgradeTreesTV25(instancer) {
  const t0 = performance.now();
  let T = null, from = 'bake';
  if (!/(^|[?&])tv25gen=1/.test(location.search)) {
    try { T = await loadBake25(); }
    catch (e) { console.warn(`[trees25] no usable bake (${e.message}): generating at runtime — run \`node tools/bake_trees.mjs\``); }
  }
  if (!T) { from = 'runtime'; T = await generate25(); }
  const m0 = performance.now();
  // ---- bark: the prop light trim (STREET_CAL) like every other thing standing on the pavement. Four materials, one
  // program (identical defines and hooks; only the textures differ).
  const STREET_CAL = [1.94, 1.70, 1.47];
  // TR34 (2026-10-01, `?tr34=0` restores): the street trunks rendered pale and smooth. Measured at s120 (BID3 r12 plate vs
  // (39,37,31), p50 34 / std 17.2. New York's honeylocust, sophora, oak and maple bark is dark and furrowed; the plane's
  // camouflage plates are pale in life and keep most of theirs. A first step (oak/willow 0.58) moved that trunk only from
  // luma ~97 to ~88 (shots/ar34/trees/w2r1a, the trunk at x 960-995, rows 520-680): the trunk under a crown is lit by the
  // ambient, which the albedo scales less than it looks. 0.45 and a deeper normal; the rest of the gap is the canopy's
  // shade on the trunk (open, round 2).
  const TR34B = TR34 ? { oak: [0.45, 1.6], willow: [0.45, 1.6], birch: [0.5, 1.4], plane: [0.86, 1.3] } : {};
  const mkBark = (B, k) => {
    const m = new THREE.MeshStandardMaterial({ map: B.map, normalMap: B.normal, roughness: 0.93, metalness: 0, vertexColors: true });
    const tb = TR34B[k];
    if (tb) m.color.setScalar(tb[0]);
    if (B.normal) m.normalScale.set(B.ns * (tb ? tb[1] : 1), B.ns * (tb ? tb[1] : 1));
    return applyLightTrim(applyCityAO(applySnowCap(m)), STREET_CAL);
  };
  const bark = {};
  for (const [k, B] of Object.entries(T.barkTex)) bark[k] = mkBark(B, k);
  // baked set: the bark JPGs decode after the trees are up; swap the real maps in when they land (no recompile)
  if (T.barkReady) T.barkReady.then((D) => { for (const [k, B] of Object.entries(D)) if (bark[k]) { bark[k].map = B.map; bark[k].normalMap = B.normal; } }).catch((e) => console.warn('[trees25] bark maps', e));
  const NOTHING = new THREE.BufferGeometry();
  NOTHING.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  NOTHING.setIndex([0, 1, 2]);
  let nBuilt = 0;
  for (const [base, G] of T.geos) {
    const pT = instancer.pools.get(base + 'Trunk'), pC = instancer.pools.get(base + 'Crown');
    if (!pT || !pC) continue;
    pT.mesh.geometry = G.trunk0; pT.mesh.material = bark[G.bark] || bark.oak;
    pC.mesh.geometry = G.leaves0;
    instancer.setLOD(base + 'Crown', G.leaves1, T25.LOD);
    // far trees draw their trunk inside the crown LOD (the bark-cell proxy): the trunk pool draws near only
    instancer.setLOD(base + 'Trunk', NOTHING, T25.LOD);
    if (pT.mesh2) pT.mesh2.visible = false;
    if (pT.shadow2) pT.shadow2.castShadow = false;
    // …and no far-cascade proxy for the bark: it is a BOX fitted to the whole branch mesh (limbs span the crown),
    // i.e. a crown-sized box shadow under every distant tree; the crown's own blob proxy already covers it
    if (pT.far) pT.far.castShadow = false;
    nBuilt++;
  }
  applyEdgeFade(instancer);
  applyCrownShading25(instancer.crownMat);
  // N26: the canopy's x3.2 multiple-scattering gain is a DAYLIGHT calibration; on the warm night bounce it lit every crown in
  // the street (harlemRowN: canopy 60,51 -> 34,24 at x1.0, lamp core unchanged). Night 0.15 -> 0.6 takes it to 1.0; golden
  // (0.05) and day keep 3.2 exactly.
  if (N26) {
    const B0 = LEAF25.bal.value.y;
    const nightBal = () => { const n = ENV.night.value, t = Math.min(1, Math.max(0, (n - 0.15) / 0.45)); LEAF25.bal.value.y = B0 + (1.0 - B0) * t * t * (3 - 2 * t); requestAnimationFrame(nightBal); };
    requestAnimationFrame(nightBal);
  }
  // TR34D: the dither's frame index (interleaved gradient noise wants a new offset every frame; 64 is plenty)
  if (TR34D) { const tick = () => { DITH34.value = (DITH34.value + 1) % 64; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  instancer.crownMat.map = T.atlas;
  instancer.crownMat.alphaTest = T25.ALPHA;
  if (TA2C) instancer.crownMat.alphaToCoverage = true;
  // TR34S: a leaf's cuticle is glossy, and the sky it reflects is what makes real foliage read blue-green and less saturated
  // than its albedo. The crown was at roughness 0.95 (instancer.js), i.e. no sky reflection: measured over six 125th Street
  // NOT ON BY DEFAULT: in Central Park (record.mjs --probe t4Lake/t4Mall, shots/ar34/trees/cp_after vs cp_before) the same
  // 0.55 turned the sunlit crowns teal and the Mall's golden canopy blue-grey. `?leafrough=<r>` is the measurement switch.
  { const lr = Number(T25Q?.get('leafrough')); if (lr > 0 && lr <= 1) instancer.crownMat.roughness = lr; }
  instancer.crownMat.needsUpdate = true;
  // TR36: the finer forms over their trees25 pools (the crown material above is the chain they build on)
  const main = T.main + performance.now() - m0;
  let tr36 = null;
  const t36 = performance.now();
  if (TR36_FETCH) {
    try { tr36 = await applyTR36(instancer, STREET_CAL); tr36.ms = performance.now() - t36; }
    catch (e) { console.warn(`[trees36] kept trees25 (${e.message}): run \`node tools/ar35/trees/bake36.mjs\``); }
  }
  // UE14: the 90 m swap as a cross-fade for the trees25 crowns and every trunk (see FADE14)
  if (FADE14) { try { console.log('[ue14] cross-fade', JSON.stringify(applyFade14(instancer, T.geos))); } catch (e) { console.warn('[ue14] hard swap kept', e); } }
  if (applyBias14(instancer.crownMat)) console.log('[ue14] leaf mip bias', BIAS14);
  // UE14 end
  // BX-TREES (`?bxtrees=1`, OFF by default; city/bxTrees.js, docs/notes/ar34-bx-trees.md): the asset set shared with the
  // Cycles export over its forms' pools. Without the flag nothing here runs and bxTrees.js is never fetched.
  if (T25Q && T25Q.get('bxtrees') === '1') {
    try { const { applyBXTrees } = await import('./bxTrees.js'); console.log('[bxtrees]', JSON.stringify(await applyBXTrees(instancer, { far: FAR37, lod37: LOD37, lodDist: T25.LOD }))); }
    catch (e) { console.warn('[bxtrees] kept the web trees', e); }
  }
  const s = T.stats;
  console.log(`[trees25] ${nBuilt} forms from the ${from} in ${(performance.now() - t0).toFixed(0)} ms wall, ${main.toFixed(0)} ms main thread`
    + ` (ready ${(performance.now() / 1000).toFixed(1)} s after navigation): bark ${s.trisT} tris, leaves ${s.tris0} (LOD0) / ${s.tris1} (LOD1, ${T25.LOD} m)`
    + `; TR34 bark ${TR34 ? 'on' : 'off'}, leaf shading ${TR34S ? 'on' : 'off'}, dithered edge ${TR34D ? 'on' : 'off'}, crown roughness ${instancer.crownMat.roughness}${TA2C ? ', alpha-to-coverage' : ''}; TR35 street leaves ${TR35 ? (ALL35 ? 'on (everywhere)' : CITY35 ? 'on (everywhere outside Central Park)' : 'on (125th Street and Hunters Point)') : 'off'}`
    + `; TR36 ${tr36 ? `${tr36.n} pools (bark ${tr36.stats.trisT} tris, leaves ${tr36.stats.tris0} / ${tr36.stats.tris1}; ${(tr36.stats.bytes / 1e6).toFixed(1)} MB, +${tr36.ms.toFixed(0)} ms wall); TR37 scanned bark on ${tr36.nb} more pools, ${tr36.px38} stand-in vertices in their bark colour, relief ${POM37.value.x > 0 ? 'on' : 'off'}, far pool ${FAR37.length ? `${FAR37.length} pools past ${LOD37.value.z} m, cross-fades +-${LOD37.value.y} / +-${LOD37.value.w} m` : 'off'}` : TR36 ? 'not loaded' : 'off'}`);
  if (typeof window !== 'undefined') window.__TREE25_BOOT = { from, wallMs: performance.now() - t0, mainMs: main, readyS: performance.now() / 1000, startS: t0 / 1000, fetchStartS: TV25_BAKE ? TV25_BAKE.t0 / 1000 : null, steps: T.steps || null };
}
