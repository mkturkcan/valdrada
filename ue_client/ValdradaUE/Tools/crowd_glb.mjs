// The crowd's photoreal bodies (client/public/models/peds24) as skinned glTF that Unreal's importer reads: each body's LOD0
// uncompressed, its skeleton from the manifest (the bones' rest translations and rotations, the body's inverse bind
// matrices), split into one primitive per texture slot and UDIM tile (material `p_<kind>_<slot>_<tile>_c<class>`, so the
// client dresses a variant by giving each slot its layer's material), the bags left out, and the body's own walk, idle and
// run clips as animations: the web's clips (clips_<skeleton>.bin, two RGBA32F texels per bone and frame: the local
// rotation, then the translation and a valid flag) with the hips' translation scaled to this body's hips as crowd.js does.
// Tools/make_crowd.py imports the result.
//   node ue_client/ValdradaUE/Tools/crowd_glb.mjs <out dir> [body ...]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const req = createRequire(path.join(ROOT, 'tools', 'assets', 'package.json'));
const imp = (n) => import(pathToFileURL(req.resolve(n)).href);
const { NodeIO } = await imp('@gltf-transform/core');
const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
const { MeshoptDecoder } = await imp('meshoptimizer');
const { prune, dequantize } = await imp('@gltf-transform/functions');
const SRC = process.env.CROWD_SRC || path.join(ROOT, 'client', 'public', 'models', 'peds24');

const out = process.argv[2];
const only = new Set(process.argv.slice(3));
fs.mkdirSync(out, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const M = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const CL = JSON.parse(fs.readFileSync(path.join(SRC, 'clips.json'), 'utf8')).clips;
const clipBin = {};
for (const s of Object.keys(M.skeletons)) {
  const b = fs.readFileSync(path.join(SRC, `clips_${s}.bin`));
  clipBin[s] = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
const clip = (name) => CL.find((c) => c.name === name);
// the clips a body plays (crowd.js _clipFor and KC27: children walk their own clips, GEN3 children never joy_c)
function clipsFor(name, B) {
  if (B.skeleton === 'gen3') return { walk: 'walk_c', idle: 'idle_c' };
  if (B.height < 1.4) return { walk: /girl/i.test(name) ? 'walk_f' : 's_neutral_walk', idle: 'idle_b', run: 'run_g' };
  return { walk: 's_neutral_walk', idle: 's_neutral_idle', run: 'run_f' };
}
const CLS = ['skin', 'cloth', 'eye', 'hair'];   // (the class byte's meaning is the web's; kept in the material's name)
const summary = {};

for (const [name, B] of Object.entries(M.bodies)) {
  if (only.size && !only.has(name)) continue;
  const S = M.skeletons[B.skeleton], nb = S.bones.length;
  const doc = await io.read(path.join(SRC, B.file));
  await doc.transform(dequantize());
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const buf = root.listBuffers()[0] || doc.createBuffer();
  // LOD0's primitives, in the body's model frame
  let lod0 = null;
  scene.traverse((n) => { if (n.getName() === 'LOD0' && n.getMesh()) lod0 = n; });
  if (!lod0) { console.log(`${name}: no LOD0`); continue; }
  const W = lod0.getWorldMatrix();
  const xf = (v, w) => [W[0] * v[0] + W[4] * v[1] + W[8] * v[2] + w * W[12], W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + w * W[13], W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + w * W[14]];
  const mesh = doc.createMesh(name);
  const mats = new Map();
  let tris = 0, dropped = 0;
  for (const prim of lod0.getMesh().listPrimitives()) {
    const kind = (prim.getMaterial() && prim.getMaterial().getName()) === 'hair' ? 'hair' : 'opaque';
    const A = (k) => prim.getAttribute(k);
    const P = A('POSITION'), N = A('NORMAL'), U = A('TEXCOORD_0'), J = A('JOINTS_0'), Wt = A('WEIGHTS_0');
    const SL = A('_SLOT'), CC = A('_CLS'), PA = A('_PART');
    const I = prim.getIndices();
    const nTri = I.getCount() / 3;
    const groups = new Map();
    const e = [0, 0, 0, 0];
    for (let t = 0; t < nTri; t++) {
      const a = I.getScalar(t * 3);
      const slot = Math.round(SL ? SL.getElement(a, e)[0] : 0), cls = Math.round(CC ? CC.getElement(a, e)[0] : 0), part = Math.round(PA ? PA.getElement(a, e)[0] : 0);
      if (part >= 10) { dropped++; continue; }   // a bag: the client draws none
      let u = 0;
      for (let k = 0; k < 3; k++) u += U.getElement(I.getScalar(t * 3 + k), e)[0];
      const tile = kind === 'opaque' ? Math.max(0, Math.floor(u / 3)) : 0;
      const key = `${kind}_${slot}_${tile}_c${cls}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    for (const [key, list] of groups) {
      const remap = new Map(), pos = [], nrm = [], uv = [], jo = [], we = [], idx = [];
      for (const t of list) for (let k = 0; k < 3; k++) {
        const v = I.getScalar(t * 3 + k);
        let r = remap.get(v);
        if (r === undefined) {
          r = remap.size; remap.set(v, r);
          pos.push(...xf(P.getElement(v, e).slice(0, 3), 1));
          const n = xf(N.getElement(v, e).slice(0, 3), 0), l = Math.hypot(...n) || 1;
          nrm.push(n[0] / l, n[1] / l, n[2] / l);
          const q = U.getElement(v, e);
          uv.push(q[0] - Math.floor(q[0]), q[1]);   // (the UDIM tile is the face's layer offset)
          jo.push(...J.getElement(v, [0, 0, 0, 0]));
          const w = Wt.getElement(v, [0, 0, 0, 0]), s = w[0] + w[1] + w[2] + w[3] || 1;
          we.push(w[0] / s, w[1] / s, w[2] / s, w[3] / s);
        }
        idx.push(r);
      }
      const acc = (arr, type, Ctor) => doc.createAccessor().setType(type).setArray(new Ctor(arr)).setBuffer(buf);
      if (!mats.has(key)) mats.set(key, doc.createMaterial('p_' + key).setMetallicFactor(0).setRoughnessFactor(0.7));
      const np = doc.createPrimitive().setMaterial(mats.get(key))
        .setAttribute('POSITION', acc(pos, 'VEC3', Float32Array)).setAttribute('NORMAL', acc(nrm, 'VEC3', Float32Array))
        .setAttribute('TEXCOORD_0', acc(uv, 'VEC2', Float32Array)).setAttribute('JOINTS_0', acc(jo, 'VEC4', Uint16Array))
        .setAttribute('WEIGHTS_0', acc(we, 'VEC4', Float32Array)).setIndices(acc(idx, 'SCALAR', Uint32Array));
      mesh.addPrimitive(np);
      tris += list.length;
    }
  }
  // the skeleton: one node per bone at its rest pose, parented as the manifest says
  const joints = S.bones.map((bn, b) => doc.createNode(bn)
    .setTranslation([B.refT[b * 3], B.refT[b * 3 + 1], B.refT[b * 3 + 2]])
    .setRotation([B.refR[b * 4], B.refR[b * 4 + 1], B.refR[b * 4 + 2], B.refR[b * 4 + 3]]));
  const top = doc.createNode(name);
  S.parents.forEach((p, b) => (p < 0 ? top : joints[p]).addChild(joints[b]));
  const ibm = doc.createAccessor().setType('MAT4').setArray(new Float32Array(B.ibm.slice(0, nb * 16))).setBuffer(buf);
  const roots = S.parents.map((p, b) => (p < 0 ? b : -1)).filter((b) => b >= 0);
  const skin = doc.createSkin(name).setInverseBindMatrices(ibm).setSkeleton(joints[roots[0]]);
  for (const j of joints) skin.addJoint(j);
  const body = doc.createNode(name + '_mesh').setMesh(mesh).setSkin(skin);
  top.addChild(body);
  // the old nodes and meshes go
  for (const n of scene.listChildren()) scene.removeChild(n);
  scene.addChild(top);
  for (const n of root.listNodes()) if (n !== top && n !== body && !joints.includes(n)) n.dispose();
  for (const m of root.listMeshes()) if (m !== mesh) m.dispose();
  for (const m of root.listMaterials()) if (![...mats.values()].includes(m)) m.dispose();
  // the clips
  const hips = S.bones.findIndex((b) => /hips/i.test(b));
  const hipsH = hips >= 0 ? Math.hypot(B.refT[hips * 3], B.refT[hips * 3 + 1], B.refT[hips * 3 + 2]) : 1;
  const C = clipsFor(name, B), anims = {};
  for (const [role, cname] of Object.entries(C)) {
    const c = clip(cname);
    if (!c || c.skeleton !== B.skeleton) continue;
    const D = clipBin[B.skeleton], row = (r, b, k) => ((c.row + r) * nb * 2 + b * 2 + k) * 4;
    const nf = c.loopDup ? c.frames - 1 : c.frames, k = hipsH / c.hipsH;
    const times = new Float32Array(nf + 1);
    for (let f = 0; f <= nf; f++) times[f] = f / c.fps;
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buf);
    const anim = doc.createAnimation(role);
    for (let b = 0; b < nb; b++) {
      if (D[row(0, b, 1) + 3] < 0.5) continue;   // (a bone the clip does not move keeps its rest rotation)
      const q = new Float32Array((nf + 1) * 4);
      for (let f = 0; f <= nf; f++) {
        const o = row(f % nf, b, 0);
        let x = D[o], y = D[o + 1], z = D[o + 2], w = D[o + 3];
        if (f > 0 && x * q[(f - 1) * 4] + y * q[(f - 1) * 4 + 1] + z * q[(f - 1) * 4 + 2] + w * q[(f - 1) * 4 + 3] < 0) { x = -x; y = -y; z = -z; w = -w; }
        const l = Math.hypot(x, y, z, w) || 1;
        q.set([x / l, y / l, z / l, w / l], f * 4);
      }
      const sR = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC4').setArray(q).setBuffer(buf)).setInterpolation('LINEAR');
      anim.addSampler(sR).addChannel(doc.createAnimationChannel().setTargetNode(joints[b]).setTargetPath('rotation').setSampler(sR));
      if (b === hips) {
        const t = new Float32Array((nf + 1) * 3);
        for (let f = 0; f <= nf; f++) { const o = row(f % nf, b, 1); t.set([D[o] * k, D[o + 1] * k, D[o + 2] * k], f * 3); }
        const sT = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC3').setArray(t).setBuffer(buf)).setInterpolation('LINEAR');
        anim.addSampler(sT).addChannel(doc.createAnimationChannel().setTargetNode(joints[b]).setTargetPath('translation').setSampler(sT));
      }
    }
    anims[role] = { clip: cname, frames: nf, fps: c.fps, seconds: +(nf / c.fps).toFixed(4), speed: c.speed, clip_hips: c.hipsH };
  }
  for (const e2 of root.listExtensionsUsed()) e2.dispose();
  // (keepAttributes: the materials carry no textures, Tools/make_crowd.py gives the slots theirs, so a plain prune drops UV0)
  await doc.transform(prune({ keepLeaves: true, keepAttributes: true }));
  const dst = path.join(out, name + '.glb');
  await io.write(dst, doc);
  summary[name] = { skeleton: B.skeleton, height: B.height, hips: hipsH, tris, bags_dropped: dropped, slots: [...mats.keys()], anims };
  console.log(`${name}: ${tris} triangles, ${mats.size} slots, ${Object.keys(anims).join('/')} -> ${dst}`);
}
fs.writeFileSync(path.join(out, 'crowd_glb.json'), JSON.stringify({ source: SRC, bodies: summary }, null, 1));
