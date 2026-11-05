// The track recorder's ids against the API's pruning (core/api/render.mjs drops the record of every actor out of range
// after each frame): a train car that leaves the range and comes back keeps its id and has its record again. 0.7.0's
// installed client drew no road user for 80 s after its smoke test because every frame failed on a car back in range.
//
//   node tools/core/recorder_check.mjs
import * as THREE from 'three';
import { TrackRecorder } from '../../core/tracks/recorder.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const car = { sv: '1', k: 3, i: 0, x: 0, y: 12, z: 0, yaw: 0, trucks: [0, 0], roll: 0, v: 8, kind: 'r142', num: 1, dest: 0, lamps: [1, 1, 0, 0] };
const W = {
  kinds: {}, peds: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
  traffic: { cars: [], pools: {}, time: 0, signals: new Map(), parkedRecs: [] },
  ENV: { time: { value: 0 } }, trains: { carsAt: () => [car] },
};
const rec = new TrackRecorder(W, { radius: 250, pathPts: [[0, 0]] });
// one frame as render.mjs afterStep takes it: the capture, the frame lists emptied, the records out of range dropped
const step = () => {
  try { rec.capture(1 / 30); } catch (e) { return { err: e }; }
  const F = rec.frames[rec.frames.length - 1];
  rec.frames.length = 0; rec.camera.length = 0; rec.simTime.length = 0; rec.lightFrames.length = 0;
  const ids = new Set(F.train.map((t) => t.id));
  for (const id of rec.actors.keys()) if (!ids.has(id)) rec.actors.delete(id);
  return F;
};
const F1 = step();
const id = F1.train?.[0]?.id;
ok(!F1.err && F1.train.length === 1 && rec.actors.get(id)?.type === 'train', `a train car in range recorded (${F1.err || `id ${id}`})`);
car.x = 5000;
const F2 = step();
ok(!F2.err && F2.train.length === 0 && !rec.actors.has(id), `the car out of range: no row, its record dropped (${F2.err || F2.train.length})`);
car.x = 40;
const F3 = step();
ok(!F3.err, `the car back in range steps (${F3.err || 'no error'})`);
ok(!F3.err && F3.train[0]?.id === id && rec.actors.get(id)?.type === 'train', `the car back in range keeps its id and has its record (${F3.err ? '-' : F3.train[0]?.id})`);
console.log(fails ? `[recorder] ${fails} failed` : '[recorder] all passed');
process.exit(fails ? 1 : 0);
