// EL14 — elevated rail structures (public/data/elevated.json from tools/pipeline/elevated.mjs): the J/M/Z el over
// Broadway in Williamsburg/Bushwick, the Myrtle Avenue el and the IRT viaduct at 125th St. A riveted-steel two-storey
// structure: per track a ballast/track bed on two longitudinal plate girders, and every ~15 m a BENT — two columns on
// the kerb lines of the street below carrying a cross girder the tracks sit on. Everything is boxes merged into two
// draw calls (steel, bed), the same Lambert steel the bridge kit uses (src/city/bridgeKit.js) so the two structures
// read as one family. ?el14=0 leaves it out.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// AR32W: the Manhattan Valley Viaduct's arch over W 125th St (city/w125wKit.js mvvBuild) carries the IRT deck across the
// street, so the plain bents that stood in its span are left out (?ar32w=0 keeps them)
import { mvvArchSkip } from './w125wData.js';   // AR32W
// AR33: the viaduct part (vk/viaducts.js) may take over a stretch of an elevated line: globalThis.__AR33VK.skipBent(x, z)
// and .skipTrack(x, z) (world metres) leave those bents and track segments to it; the parts load before this builds
import { areasReady } from './areas.js';
import { HA_ON, haAnchorBridges, haAnchorTracks } from '../world/haAnchor.js';   // P1 TERRAIN: the J/M/Z on the Williamsburg Bridge

const EL14 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('el14') === '0');
const STEEL = 0x34383b;    // the els are painted a near-black green that weathers to rust-brown streaks
const BED = 0x3a3733;      // tie-and-ballast deck read from below/aside as a dark band
const RAIL = 0x6b6f72;

function boxAt(list, w, h, d, x, y, z, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1)));
  list.push(g);
}

export async function buildElevated(scene) {
  if (!EL14) return null;
  try { await areasReady; } catch {}
  const VK = globalThis.__AR33VK || null;   // AR33
  let D;
  try { D = await (await fetch('data/elevated.json')).json(); } catch { return null; }
  if (!D || !D.tracks || !D.tracks.length) return null;
  // P1 TERRAIN (`?terrain=p1`): the J/M/Z over the Williamsburg Bridge on its LiDAR deck and the re-seated bridge
  // (world/haAnchor.js haAnchorTracks; the bridges re-seated here as the streamer re-seats them)
  if (HA_ON) {
    try {
      const tb = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('tiles')) || 'tiles';
      const B = await (await fetch(`${tb}/bridges.json`)).json();
      await haAnchorBridges(B);
      const n = await haAnchorTracks(D, B);
      if (n) console.log(`[elevated] ${n} tracks on the re-seated bridges' decks`);
    } catch (e) { console.warn('[terrain p1] elevated tracks', e); }
  }
  const steel = [], bed = [], rail = [];
  const U = D.deckUnder ?? 1.35;
  let segs = 0;
  for (const t of D.tracks) {
    const P = t.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const A = P[i], B = P[i + 1];
      const dx = B[0] - A[0], dz = B[2] - A[2], L = Math.hypot(dx, dz);
      if (L < 0.3) continue;
      const cx = (A[0] + B[0]) / 2, cz = (A[2] + B[2]) / 2, cy = (A[1] + B[1]) / 2;   // cy = top of rail
      if (VK && VK.skipTrack && VK.skipTrack(cx, cz)) continue;   // AR33
      const rot = Math.atan2(-dz, dx);                 // turns local +X into the track direction
      const nx = -dz / L, nz = dx / L;                 // lateral unit
      const ext = L + 0.08;                            // overlap so segment joints do not open at bends
      boxAt(bed, ext, 0.42, 2.7, cx, cy - 0.21 - 0.12, cz, rot);                                   // tie/ballast bed
      for (const s of [-1, 1]) {
        boxAt(steel, ext, 0.90, 0.28, cx + nx * s * 1.25, cy - 0.12 - 0.42 - 0.45, cz + nz * s * 1.25, rot);   // plate girders
        boxAt(rail, ext, 0.14, 0.07, cx + nx * s * 0.72, cy - 0.07, cz + nz * s * 0.72, rot);                     // running rails
      }
      segs++;
    }
  }
  for (const b of D.bents) {
    // rot turns local +X into the bent's normal: column A at -a, column B at +b along it
    const c = Math.cos(b.rot), s = -Math.sin(b.rot);   // +X rotated by rot about Y -> (cos, 0, -sin)
    const h = b.y1 - b.y0;
    if (h < 3) continue;
    if (mvvArchSkip(b.x, b.z)) continue;   // AR32W: in the span of the Manhattan Valley arch at 125th St
    if (VK && VK.skipBent && VK.skipBent(b.x, b.z)) continue;   // AR33: a stretch the viaduct part builds itself
    for (const off of [-b.a, b.b]) {
      const x = b.x + c * off, z = b.z + s * off;
      boxAt(steel, 0.55, h, 0.55, x, b.y0 + h / 2, z, b.rot);                 // column
      boxAt(steel, 0.95, 0.35, 0.95, x, b.y1 - 0.175, z, b.rot);              // capital plate
      boxAt(steel, 0.95, 0.30, 0.95, x, b.y0 + 0.15, z, b.rot);               // base plate
    }
    const span = b.a + b.b;
    boxAt(steel, span + 1.4, 0.95, 0.42, b.x + c * (b.b - b.a) / 2, b.y1 + 0.475, b.z + s * (b.b - b.a) / 2, b.rot);   // cross girder
  }
  const group = new THREE.Group();
  group.name = 'elevated';
  const add = (list, hex) => {
    if (!list.length) return;
    const g = mergeGeometries(list, false);
    for (const x of list) x.dispose();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: hex }));
    m.castShadow = true; m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.layers.enable(3);   // far shadow cascade, like the dressed buildings
    group.add(m);
  };
  add(steel, STEEL); add(bed, BED); add(rail, RAIL);
  scene.add(group);
  console.log(`[elevated] ${D.tracks.length} tracks, ${segs} deck segments, ${D.bents.length} bents`);
  return group;
}
