// The fleet's models as Unreal's glTF importer reads them: client/public/models/fleet24/<kind>.glb is meshopt-compressed
// with KTX2 (Basis Universal) textures, neither of which the importer supports. Each model is written again with its
// LOD0 only, its geometry uncompressed and its textures as PNG (basisu -unpack, the CLI tools/assets/lib/tex.mjs builds
// with); Tools/make_fleet.py imports the result. Each wheel (the root's `hubs`: centre, radius and width, as the web spins
// them) is cut out of the body into <kind>__w<n>.glb, centred on the hub, so the client turns and steers it (the body file
// keeps the rest): the triangles the web's own wheel attribute marks (fleet24.js `_wheel`: 1..8 = FL, FR, RL, RR, then a
// third and fourth axle, left then right; hubs[n - 1] is that wheel's hub), or else those inside the hub's cylinder.
//   node ue_client/ValdradaUE/Tools/fleet_glb.mjs <out dir> [kind ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const req = createRequire(path.join(ROOT, 'tools', 'assets', 'package.json'));
const imp = (n) => import(pathToFileURL(req.resolve(n)).href);
const { NodeIO } = await imp('@gltf-transform/core');
const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
const { MeshoptDecoder } = await imp('meshoptimizer');
const { prune, dequantize, transformPrimitive, cloneDocument } = await imp('@gltf-transform/functions');
const BASISU = process.env.BASISU || '/data0/projectnyc_aux/.tools/basisu/basis_universal-1_60/bin/basisu';
const SRC = process.env.FLEET_SRC || path.join(ROOT, 'client', 'public', 'models', 'fleet24');

const out = process.argv[2];
const only = new Set(process.argv.slice(3));
fs.mkdirSync(out, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fleetglb_'));
const BAD = [];   // (wheels not centred on their hubs, kinds whose hubs cut no wheel: the run fails at its end)
for (const fn of fs.readdirSync(SRC).filter((f) => f.endsWith('.glb')).sort()) {
  const kind = fn.slice(0, -4);
  if (only.size && !only.has(kind)) continue;
  const doc = await io.read(path.join(SRC, fn));
  const root = doc.getRoot();
  // LOD0 only: the other levels' nodes go, prune drops their meshes
  for (const n of root.listNodes()) if (/LOD[1-9]$/.test(n.getName())) n.dispose();
  // one mesh in the model's frame (metres, x left, y up, z forward, as the hubs are): every part's primitives (the NYPD
  // car's chrome, glass, paint, ...; an articulated bus's front, joint and rear, drawn rigid; a one-part model's LOD0,
  // stored normalised under a scaled node) moved through its node's world matrix into one mesh on a node 'LOD0' under
  // the root, the root's transform baked too (the root keeps its extras, the hubs make_fleet.py reads). Cut in the
  // node's own frame, a wheel came out shrunk by the node's scale and off its hub by a metre: Unreal drew small tyres
  // orbiting the hubs, the arches empty; a model in parts lost its root and its hubs with it, and drew no wheels
  const top = doc.getRoot().getDefaultScene() || root.listScenes()[0];
  const R0 = top.listChildren()[0];
  const parts = [];
  top.traverse((n) => { if (n.getMesh()) parts.push(n); });
  if (parts.length) {
    const merged = doc.createMesh(kind);
    for (const n of parts) {
      const M = n.getWorldMatrix();
      for (const prim of n.getMesh().listPrimitives()) { transformPrimitive(prim, M); merged.addPrimitive(prim); }
    }
    const holder = doc.createNode('LOD0').setMesh(merged);
    for (const n of parts) n.setMesh(null);
    R0.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).addChild(holder);
  }
  let png = 0;
  for (const t of root.listTextures()) {
    if (t.getMimeType() !== 'image/ktx2') continue;
    const base = `t${png}`, d = path.join(tmp, kind);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, base + '.ktx2'), Buffer.from(t.getImage()));
    execFileSync(BASISU, ['-unpack', base + '.ktx2', '-no_ktx', '-format_only', '10'], { cwd: d, stdio: 'ignore' });
    const hit = fs.readdirSync(d).filter((f) => f.startsWith(base + '_unpacked_rgba_') && /level_0/.test(f) && f.endsWith('.png')).sort()[0];
    if (!hit) throw new Error(`${kind}: basisu wrote no PNG for texture ${png}`);
    t.setImage(new Uint8Array(fs.readFileSync(path.join(d, hit)))).setMimeType('image/png');
    png++;
  }
  await doc.transform(dequantize());   // (quantized positions and normals as floats: the importer reads no KHR_mesh_quantization)
  // the lamps' roles (the models' _LAMP: head, blinkers, tail, reverse, sirens; fleet24.js ROLE) as UV 1's x, which
  // M_client_lamp reads (Unreal's importer keeps TEXCOORD_n, not custom attributes); UV 0 zero where the part has none
  for (const m of root.listMeshes()) for (const prim of m.listPrimitives()) {
    const LA = prim.getAttribute('_LAMP') || prim.getAttribute('_lamp');
    if (!LA) continue;
    const nv = LA.getCount(), uv1 = new Float32Array(nv * 2), el = [0];
    for (let v = 0; v < nv; v++) uv1[v * 2] = Math.round(LA.getElement(v, el)[0] * (LA.getNormalized() ? 255 : 1));
    if (!prim.getAttribute('TEXCOORD_0')) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(nv * 2)).setBuffer(LA.getBuffer()));
    prim.setAttribute('TEXCOORD_1', doc.createAccessor().setType('VEC2').setArray(uv1).setBuffer(LA.getBuffer()));
  }
  // the wheels: a triangle whose three corners carry one wheel's mark goes to that wheel, moved to its hub's centre
  const hubs = (top.listChildren()[0] && top.listChildren()[0].getExtras && (top.listChildren()[0].getExtras() || {}).hubs) || [];
  const wheelNodes = [];
  if (hubs.length && !process.env.FLEET_NO_WHEELS) {
    const body = [];
    top.traverse((n) => { if (n.getMesh()) body.push(n); });
    const wmesh = hubs.map((h, k) => doc.createMesh(`${kind}_w${k + 1}`));
    for (const n of body) for (const prim of n.getMesh().listPrimitives()) {
      const P = prim.getAttribute('POSITION'), I = prim.getIndices();
      if (!P || !I) continue;
      const nv = P.getCount(), owner = new Int16Array(nv).fill(-1), e = [0, 0, 0], WA = prim.getAttribute('_WHEEL') || prim.getAttribute('_wheel'), we = [0];
      for (let v = 0; v < nv; v++) {
        if (WA) {
          const wi = Math.round(WA.getElement(v, we)[0] * (WA.getNormalized() ? 255 : 1));
          if (wi >= 1 && wi <= hubs.length) owner[v] = wi - 1;
          continue;
        }
        P.getElement(v, e);
        for (let k = 0; k < hubs.length; k++) {
          const h = hubs[k];
          if (Math.abs(e[0] - h.p[0]) <= h.w / 2 + 0.03 && Math.hypot(e[1] - h.p[1], e[2] - h.p[2]) <= h.r * 1.03) { owner[v] = k; break; }
        }
      }
      // (a mark goes to the hub nearest its vertices: the SUV's rear marks are the other side's hubs)
      const sum = hubs.map(() => [0, 0, 0]);
      for (let v = 0; v < nv; v++) if (owner[v] >= 0) { P.getElement(v, e); const s = sum[owner[v]]; s[0] += e[0]; s[1] += e[2]; s[2]++; }
      const to = hubs.map((_, k) => {
        if (!sum[k][2]) return k;
        const cx = sum[k][0] / sum[k][2], cz = sum[k][1] / sum[k][2];
        let best = k, bd = Infinity;
        hubs.forEach((h, j) => { const d = Math.hypot(cx - h.p[0], cz - h.p[2]); if (d < bd) { bd = d; best = j; } });
        return best;
      });
      if (to.some((j, k) => j !== k)) {
        console.log(`${kind}: wheel marks ${to.map((j, k) => (j !== k ? `${k + 1} -> ${j + 1}` : '')).filter(Boolean).join(', ')} (the hub nearest their vertices)`);
        for (let v = 0; v < nv; v++) if (owner[v] >= 0) owner[v] = to[owner[v]];
      }
      const keep = [], wtri = hubs.map(() => []);
      for (let t = 0; t < I.getCount(); t += 3) {
        const a = I.getScalar(t), b = I.getScalar(t + 1), c = I.getScalar(t + 2);
        if (owner[a] >= 0 && owner[a] === owner[b] && owner[a] === owner[c]) wtri[owner[a]].push(a, b, c);
        else keep.push(a, b, c);
      }
      if (keep.length === I.getCount()) continue;
      const sub = (list, shift) => {
        const remap = new Map(), idx = [];
        for (const v of list) { if (!remap.has(v)) remap.set(v, remap.size); idx.push(remap.get(v)); }
        const np = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
        for (const sem of prim.listSemantics()) {
          const A = prim.getAttribute(sem), sz = A.getElementSize(), out = new (A.getArray().constructor)(remap.size * sz), el = new Array(sz).fill(0);
          for (const [v, r] of remap) {
            A.getElement(v, el);
            if (sem === 'POSITION' && shift) { el[0] -= shift[0]; el[1] -= shift[1]; el[2] -= shift[2]; }
            out.set(el, r * sz);
          }
          np.setAttribute(sem, doc.createAccessor().setType(A.getType()).setArray(out).setNormalized(A.getNormalized()).setBuffer(A.getBuffer()));
        }
        np.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(I.getBuffer()));
        return np;
      };
      hubs.forEach((h, k) => { if (wtri[k].length) wmesh[k].addPrimitive(sub(wtri[k], h.p)); });
      const mesh = n.getMesh();
      mesh.removePrimitive(prim);
      if (keep.length) mesh.addPrimitive(sub(keep, null));
    }
    hubs.forEach((h, k) => { if (wmesh[k].listPrimitives().length) wheelNodes.push([{ ...h, n: k + 1 }, doc.createNode(`wheel${k + 1}`).setMesh(wmesh[k])]); });
    // each wheel centred on its hub and as tall as its tyre (y and z: the axle is x), or the run fails at its end
    for (const [h, wn] of wheelNodes) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], q = [0, 0, 0];
      for (const prim of wn.getMesh().listPrimitives()) {
        const A = prim.getAttribute('POSITION');
        for (let v = 0; v < A.getCount(); v++) { A.getElement(v, q); for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], q[c]); hi[c] = Math.max(hi[c], q[c]); } }
      }
      const cy = (lo[1] + hi[1]) / 2, cz = (lo[2] + hi[2]) / 2, dy = hi[1] - lo[1], dz = hi[2] - lo[2], tol = 0.15 * h.r + 0.03;
      const ok = Math.abs(cy) <= tol && Math.abs(cz) <= tol && dy >= 1.6 * h.r && dy <= 2.4 * h.r && dz >= 1.6 * h.r && dz <= 2.4 * h.r;
      if (!ok) BAD.push(`${kind} wheel ${h.n}: centre y ${cy.toFixed(3)} z ${cz.toFixed(3)}, height ${dy.toFixed(3)} and length ${dz.toFixed(3)} for a radius ${h.r}`);
    }
  }
  if (hubs.length && !wheelNodes.length && !process.env.FLEET_NO_WHEELS) BAD.push(`${kind}: ${hubs.length} hubs, no wheel cut`);
  for (const e of root.listExtensionsUsed()) {
    const n = e.extensionName;
    if (n === 'KHR_texture_basisu' || n === 'EXT_meshopt_compression' || n === 'KHR_mesh_quantization') e.dispose();
  }
  // each wheel its own file (a document holding the wheel's node alone), then the body without them
  for (const [h, wn] of wheelNodes) {
    top.addChild(wn);
    const wd = cloneDocument(doc);
    top.removeChild(wn);
    const ws = wd.getRoot().getDefaultScene() || wd.getRoot().listScenes()[0];
    for (const c of ws.listChildren()) ws.removeChild(c);
    const wn2 = wd.getRoot().listNodes().find((x) => x.getName() === `wheel${h.n}`);
    for (const p of wd.getRoot().listNodes()) if (p !== wn2) p.dispose();
    ws.addChild(wn2);
    // (no textures: Tools/make_fleet.py gives the wheel's slots the body's material instances, matched by name)
    for (const m of wd.getRoot().listMaterials()) m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
    await wd.transform(prune({ keepAttributes: true }));   // (UV0 kept for those material instances' textures)
    await io.write(path.join(out, `${kind}__w${h.n}.glb`), wd);
  }
  for (const [, wn] of wheelNodes) wn.dispose();
  await doc.transform(prune({ keepAttributes: true }));   // (the lamps' UV 1 has no texture to keep it)
  const dst = path.join(out, fn);
  await io.write(dst, doc);
  console.log(`${kind}: ${png} textures as PNG, ${root.listMeshes().length} mesh(es), ${wheelNodes.length} wheels -> ${dst}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
if (BAD.length) { for (const b of BAD) console.log('BAD ' + b); console.log(`fleet_glb: ${BAD.length} bad wheel(s)`); process.exit(2); }
