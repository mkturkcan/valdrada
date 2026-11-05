// The subway and commuter cars (the page's own models, client/src/city/trains: r62a, m7a, m8) as glTF for the client: one
// car of each kind at LOD0 as models.js staticCar assembles it (shell, doors closed, trucks and wheelsets at rest), merged
// into one primitive per material class (material `t_<class>`) in the car's frame (+x its front, y up, metres, the body's
// centre at rail height as the state's records place it). The lamps, the route and number signs and the decals are left
// out (their atlas is painted on a canvas the headless shim does not draw). Tools/make_trains.py imports the result.
//   node ue_client/ValdradaUE/Tools/trains_glb.mjs <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
await import(path.join(ROOT, 'core', 'env', 'shim.mjs'));
const THREE = await import(pathToFileURL(createRequire(path.join(ROOT, 'client', 'package.json')).resolve('three')).href);
const { carModel, doorSlots } = await import(path.join(ROOT, 'client', 'src', 'city', 'trains', 'models.js'));
const req = createRequire(path.join(ROOT, 'tools', 'assets', 'package.json'));
const { Document, NodeIO } = await import(pathToFileURL(req.resolve('@gltf-transform/core')).href);

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const SKIP = new Set(['lamps', 'signs', 'decals', 'lit']);
const summary = {};
for (const kind of ['r62a', 'm7a', 'm8']) {
  const m = carModel(kind), S = m.spec;
  const parts = {};   // class -> [geometry with its matrix baked]
  const add = (geos, mtx = null) => {
    for (const [k, geo] of Object.entries(geos)) {
      if (SKIP.has(k)) continue;
      const g = geo.clone();
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a);
      if (mtx) g.applyMatrix4(mtx);
      (parts[k] = parts[k] || []).push(g.index ? g.toNonIndexed() : g);
    }
  };
  add(m.lod[0]);
  const lw = S.doorW / S.leaves;
  for (const [x] of doorSlots(S)) for (const sgn of [1, -1]) {
    const mx = new THREE.Matrix4().makeTranslation(x, 0, sgn * (S.W / 2 - 0.022));
    if (sgn < 0) mx.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    add(m.door.geos, mx);
  }
  for (const tx of [-S.truckX, S.truckX]) {
    add(m.truck, new THREE.Matrix4().makeTranslation(tx, 0, 0));
    for (const ax of [-S.wheelBase / 2, S.wheelBase / 2]) add(m.wheel, new THREE.Matrix4().makeTranslation(tx + ax, S.wheelR, 0));
  }
  const doc = new Document();
  const buf = doc.createBuffer();
  const mesh = doc.createMesh(kind);
  let tris = 0;
  for (const [k, list] of Object.entries(parts)) {
    const pos = [], nrm = [], uv = [], col = [];
    for (const g of list) {
      const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv'), C = g.getAttribute('color');
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i));
        if (N) nrm.push(N.getX(i), N.getY(i), N.getZ(i)); else nrm.push(0, 1, 0);
        if (U) uv.push(U.getX(i), U.getY(i)); else uv.push(0, 0);
        // (the weathering and the liveries are vertex colours: kit.js)
        if (C) col.push(C.getX(i), C.getY(i), C.getZ(i), 1); else col.push(1, 1, 1, 1);
      }
    }
    if (!pos.length) continue;
    const acc = (arr, type) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buf);
    const prim = doc.createPrimitive().setAttribute('POSITION', acc(pos, 'VEC3')).setAttribute('NORMAL', acc(nrm, 'VEC3')).setAttribute('TEXCOORD_0', acc(uv, 'VEC2')).setAttribute('COLOR_0', acc(col, 'VEC4'))
      .setMaterial(doc.createMaterial('t_' + k).setMetallicFactor(0).setRoughnessFactor(0.6));
    mesh.addPrimitive(prim);
    tris += pos.length / 9;
  }
  doc.createScene(kind).addChild(doc.createNode(kind).setMesh(mesh));
  await new NodeIO().write(path.join(out, kind + '.glb'), doc);
  summary[kind] = { classes: Object.keys(parts), tris, length: S.L, width: S.W };
  console.log(`${kind}: ${Object.keys(parts).length} classes, ${tris} triangles`);
}
fs.writeFileSync(path.join(out, 'trains_glb.json'), JSON.stringify(summary, null, 1));
