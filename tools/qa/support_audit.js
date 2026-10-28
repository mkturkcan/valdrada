// QA round 4 (2026-10-02): an in-page support audit of everything drawn near a point. Evaluated in the page by
// tools/qa/qa_page.mjs ({ "op": "eval", "file": ".../support_audit.js", "arg": { "c": [x, z], "r": 110 } }) or by
// tools/bshot.mjs --evalfile (then ARG is unset and the camera's x, z are the centre). Returns JSON.
//
// Parts: every visible static mesh near the point is split into its connected pieces (vertices welded at 1 cm: a kit box,
// a bar, a panel, a post), every InstancedMesh / BatchedMesh instance is one part (trees, vehicles, walkers, pooled
// furniture). Checks, all with TOL = 0.3 m:
//   float   a part whose bottom 0.3 m (grown by 0.3 m sideways and downwards) touches no other geometry, no instance box and
//           no ground (terrainAt / surfaceInfoAt): nothing under it or beside its foot to stand on or hang from
//   post    the same for a slender upright piece (posts, legs, poles, columns): its foot in the air
//   sunk    a part whose bottom lies more than TOL under the ground at its centre while its top is above it (a piece of
//           furniture, a vehicle or a prop pushed into the ground; walls and decks with footings are left out by size)
//   pierce  an upright piece (post, pole, tree trunk) whose centre line crosses a near-horizontal face of another family's
//           part more than TOL below its own top (a pole through an awning, a trunk through a canopy)
// Legitimate hangers are dropped by name (ARG.keep / the HANG list below): signal heads and mast arms, wires, luminaires,
// the viaducts' spans. Tuned by looking (docs/notes/ar34-qa.md, round 4).
(async () => {
  const A = (typeof window !== 'undefined' && window.ARG) || {};
  const E = window.__ENGINE, S = window.__STREAMER, sc = E.scene;
  const cx = A.c ? A.c[0] : E.camera.position.x, cz = A.c ? A.c[1] : E.camera.position.z;
  const R = A.r || 110, TOL = A.tol || 0.3, CS = 2;
  const X0 = cx - R, Z0 = cz - R, X1 = cx + R, Z1 = cz + R;
  const NX = Math.ceil((X1 - X0) / CS), NZ = Math.ceil((Z1 - Z0) / CS);
  const T0 = performance.now();
  const yieldF = () => new Promise((r) => setTimeout(r, 0));
  const SKIP = new RegExp(A.skip || '^(farTerrain|macro|sky|stars|clouds|water|ocean|river|fog)', 'i');
  const NOSOLID = new RegExp(A.nosolid || '(roomFill|grime|wear|decal|shadow|glow|halo|beam|spill|lightCone|flare|sk_paint|sk_mark|puddle|stain|Crown|leaf|leaves|foliage|hair|lashes|brows|eyes)', 'i');
  const HANG = new RegExp(A.hang || '(sig|signal|mast|arm|wire|cable|catenary|luminaire|lum\\b|lamp|head|banner|flag|vk-|span|girder|deck|soffit|awning|canopy|marquee|blade|bracket|fireEscape|ext\\b)', 'i');
  const lab = (o) => { const a = []; let p = o; while (p && p !== sc && a.length < 5) { if (p.name) a.push(p.name); p = p.parent; } return a.reverse().join('/') || o.type; };
  const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const fam = (l) => { const s = l.split('/').pop(); const m = /^(ar33vk|ar32[a-z]*|pk|lk|sk|fk|vg36|veh|ped|pool|nyc|tile|signs|heroes)/.exec(s); return m ? m[1] : s.split(/[:_]/)[0]; };
  const mul = (a, b) => {   // column-major 4x4 a * b
    const o = new Float64Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    return o;
  };
  const xbox = (e, b) => {  // world AABB of local box b [x0,y0,z0,x1,y1,z1] under matrix e
    const o = [e[12], e[13], e[14], e[12], e[13], e[14]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const m = e[j * 4 + i], a = m * b[j], c = m * b[j + 3];
      o[i] += Math.min(a, c); o[i + 3] += Math.max(a, c);
    }
    return o;
  };
  const inRegion = (b) => b[3] >= X0 && b[0] <= X1 && b[5] >= Z0 && b[2] <= Z1;
  // ------------------------------------------------------------------ collect
  const statics = [], insts = [];
  const posOf = (g) => { const p = g.attributes.position; if (!p) return null; return p; };
  const walk = (o) => {
    if (!o.visible) return;
    const l0 = o.name || '';
    if (SKIP.test(l0)) return;
    if ((o.isMesh || o.isInstancedMesh || o.isBatchedMesh) && o.geometry && !o.isSkinnedMesh) {
      const g = o.geometry, p = posOf(g);
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      // see-through materials (glass) still hold what touches them: kept as support, never checked as parts
      const transp = !!(mat && mat.transparent && mat.opacity < 0.3);
      if (p && p.count >= 3 && !(mat && (mat.visible === false || mat.colorWrite === false))) {
        const label = lab(o);
        if (!SKIP.test(label)) {
          if (!g.boundingBox) g.computeBoundingBox();
          const bb = g.boundingBox, lb = [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z];
          const W = o.matrixWorld.elements;
          if (o.isInstancedMesh) {
            const arr = o.instanceMatrix.array, n = Math.min(o.count, arr.length / 16);
            for (let i = 0; i < n; i++) {
              const I = arr.subarray(i * 16, i * 16 + 16);
              const sx = Math.hypot(I[0], I[1], I[2]), sy = Math.hypot(I[4], I[5], I[6]);
              if (sx < 1e-6 || sy < 1e-6) continue;
              const b = xbox(mul(W, I), lb);
              if (inRegion(b)) insts.push({ label, i, b, fam: fam(label), solid: !NOSOLID.test(label), transp });
            }
          } else if (o.isBatchedMesh) {
            const II = o._instanceInfo || [], GI = o._geometryInfo || [], md = o._matricesTexture && o._matricesTexture.image.data;
            const pa = p.array, st = p.isInterleavedBufferAttribute ? p.data.stride : 3, of = p.isInterleavedBufferAttribute ? p.offset : 0;
            const gbox = new Map();
            for (let i = 0; i < II.length; i++) {
              const it = II[i]; if (!it || !it.active || it.visible === false) continue;
              const gi = GI[it.geometryIndex]; if (!gi || !md) continue;
              let gb = gbox.get(it.geometryIndex);
              if (!gb) {
                gb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
                for (let v = gi.vertexStart; v < gi.vertexStart + gi.vertexCount; v++) for (let c = 0; c < 3; c++) { const x = pa[v * st + of + c]; if (x < gb[c]) gb[c] = x; if (x > gb[c + 3]) gb[c + 3] = x; }
                gbox.set(it.geometryIndex, gb);
              }
              const b = xbox(mul(W, md.subarray(i * 16, i * 16 + 16)), gb);
              if (inRegion(b)) insts.push({ label, i, b, fam: fam(label), solid: !NOSOLID.test(label) });
            }
          } else {
            const b = xbox(W, lb);
            if (inRegion(b)) statics.push({ o, label, b, fam: fam(label), solid: !NOSOLID.test(label), transp, ground: /^tile_-?\d+_-?\d+$/.test(label) || /^(ground|terrain)/i.test(l0) });
          }
        }
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(sc);
  await yieldF();
  // ------------------------------------------------------------------ static meshes: world positions, pieces, triangle grid
  let triTotal = 0;
  const QS = 100;  // 1 cm weld
  for (const M of statics) {
    const g = M.o.geometry, p = g.attributes.position, n = p.count;
    const e = M.o.matrixWorld.elements;
    const wp = new Float32Array(n * 3);
    const pa = p.array, st = p.isInterleavedBufferAttribute ? p.data.stride : p.itemSize, of = p.isInterleavedBufferAttribute ? p.offset : 0;
    for (let v = 0; v < n; v++) {
      const x = pa[v * st + of], y = pa[v * st + of + 1], z = pa[v * st + of + 2];
      wp[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      wp[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      wp[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    // (BKB: a tile facade the dresser replaced is discarded by the facade shader through the tile's hide mask: it holds
    // nothing up, so its vertices go far away; without this a dressed building whose walls are missing reads as supported)
    { const mt = M.o.material, hd = mt && mt.userData && mt.userData.isFacade && mt.userData.hideTex && mt.userData.hideTex.image && mt.userData.hideTex.image.data, bid = g.attributes.aBid;
      if (hd && bid) for (let v = 0; v < n; v++) if (hd[Math.round(bid.getX(v))] > 127) { wp[v * 3] = 1e7; wp[v * 3 + 1] = -1e7; wp[v * 3 + 2] = 1e7; } }
    const idx = g.index ? g.index.array : null;
    const nt = Math.floor((idx ? Math.min(g.index.count, idx.length) : n) / 3);
    M.wp = wp; M.idx = idx; M.nt = nt; M.base = triTotal; triTotal += nt;
    if (M.ground) continue;
    // weld (open addressing on the 1 cm lattice) and union the triangles' corners
    let cap = 1; while (cap < n * 2) cap <<= 1;
    const tab = new Int32Array(cap).fill(-1), rep = new Int32Array(n);
    for (let v = 0; v < n; v++) {
      const qx = Math.round(wp[v * 3] * QS), qy = Math.round(wp[v * 3 + 1] * QS), qz = Math.round(wp[v * 3 + 2] * QS);
      let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) & (cap - 1);
      for (;;) {
        const u = tab[h];
        if (u < 0) { tab[h] = v; rep[v] = v; break; }
        if (Math.round(wp[u * 3] * QS) === qx && Math.round(wp[u * 3 + 1] * QS) === qy && Math.round(wp[u * 3 + 2] * QS) === qz) { rep[v] = u; break; }
        h = (h + 1) & (cap - 1);
      }
    }
    const par = new Int32Array(n); for (let v = 0; v < n; v++) par[v] = v;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < nt; t++) {
      const a = rep[idx ? idx[t * 3] : t * 3], b = rep[idx ? idx[t * 3 + 1] : t * 3 + 1], c = rep[idx ? idx[t * 3 + 2] : t * 3 + 2];
      const ra = find(a), rb = find(b); if (ra !== rb) par[rb] = ra;
      const ra2 = find(a), rc = find(c); if (ra2 !== rc) par[rc] = ra2;
    }
    const cid = new Int32Array(n).fill(-1), tc = new Int32Array(nt);
    let nc = 0;
    const boxes = [];
    for (let t = 0; t < nt; t++) {
      const v0 = idx ? idx[t * 3] : t * 3;
      const r = find(rep[v0]);
      let k = cid[r]; if (k < 0) { k = cid[r] = nc++; boxes.push(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity, 0); }
      tc[t] = k;
      const o7 = k * 7;
      for (let j = 0; j < 3; j++) {
        const v = idx ? idx[t * 3 + j] : t * 3 + j;
        for (let c = 0; c < 3; c++) { const x = wp[v * 3 + c]; if (x < boxes[o7 + c]) boxes[o7 + c] = x; if (x > boxes[o7 + c + 3]) boxes[o7 + c + 3] = x; }
      }
      boxes[o7 + 6]++;
    }
    M.tc = tc; M.nc = nc; M.cb = boxes;
    if (performance.now() - T0 > 1e9) break;
  }
  await yieldF();
  // global triangle refs -> mesh
  const triMesh = new Int32Array(triTotal);
  statics.forEach((M, m) => triMesh.fill(m, M.base, M.base + M.nt));
  const cellOf = (x, z) => [Math.floor((x - X0) / CS), Math.floor((z - Z0) / CS)];
  const cnt = new Int32Array(NX * NZ + 1);
  const triCells = (M, t, fn) => {
    const idx = M.idx, wp = M.wp;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let j = 0; j < 3; j++) { const v = idx ? idx[t * 3 + j] : t * 3 + j; const x = wp[v * 3], z = wp[v * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    if (x1 < X0 || x0 > X1 || z1 < Z0 || z0 > Z1) return;
    const i0 = Math.max(0, Math.floor((x0 - X0) / CS)), i1 = Math.min(NX - 1, Math.floor((x1 - X0) / CS));
    const j0 = Math.max(0, Math.floor((z0 - Z0) / CS)), j1 = Math.min(NZ - 1, Math.floor((z1 - Z0) / CS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * NX + i);
  };
  for (const M of statics) { if (!M.solid && !M.ground) continue; for (let t = 0; t < M.nt; t++) triCells(M, t, (c) => cnt[c + 1]++); }
  for (let c = 0; c < NX * NZ; c++) cnt[c + 1] += cnt[c];
  const cellTris = new Int32Array(cnt[NX * NZ]), fillp = cnt.slice(0, NX * NZ);
  for (const M of statics) { if (!M.solid && !M.ground) continue; for (let t = 0; t < M.nt; t++) { const gid = M.base + t; triCells(M, t, (c) => { cellTris[fillp[c]++] = gid; }); } }
  await yieldF();
  // instance boxes in the same grid
  const icnt = new Int32Array(NX * NZ + 1);
  const boxCells = (b, fn) => {
    const i0 = Math.max(0, Math.floor((b[0] - X0) / CS)), i1 = Math.min(NX - 1, Math.floor((b[3] - X0) / CS));
    const j0 = Math.max(0, Math.floor((b[2] - Z0) / CS)), j1 = Math.min(NZ - 1, Math.floor((b[5] - Z0) / CS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * NX + i);
  };
  insts.forEach((P) => { if (P.solid) boxCells(P.b, (c) => icnt[c + 1]++); });
  for (let c = 0; c < NX * NZ; c++) icnt[c + 1] += icnt[c];
  const cellInst = new Int32Array(icnt[NX * NZ]), ifill = icnt.slice(0, NX * NZ);
  insts.forEach((P, k) => { if (P.solid) boxCells(P.b, (c) => { cellInst[ifill[c]++] = k; }); });
  // ------------------------------------------------------------------ geometry tests
  const V = new Float64Array(9);
  const triVerts = (gid) => {
    const M = statics[triMesh[gid]], t = gid - M.base, idx = M.idx, wp = M.wp;
    for (let j = 0; j < 3; j++) { const v = idx ? idx[t * 3 + j] : t * 3 + j; V[j * 3] = wp[v * 3]; V[j * 3 + 1] = wp[v * 3 + 1]; V[j * 3 + 2] = wp[v * 3 + 2]; }
    return M;
  };
  // Akenine-Moller triangle / box overlap (box centre c, half sizes h)
  const axisSep = (ax, ay, az, hx, hy, hz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z) => {
    const p0 = ax * v0x + ay * v0y + az * v0z, p1 = ax * v1x + ay * v1y + az * v1z, p2 = ax * v2x + ay * v2y + az * v2z;
    const r = hx * Math.abs(ax) + hy * Math.abs(ay) + hz * Math.abs(az);
    return Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r;
  };
  const triBox = (b) => {   // V vs box b [x0,y0,z0,x1,y1,z1]
    const cx2 = (b[0] + b[3]) / 2, cy2 = (b[1] + b[4]) / 2, cz2 = (b[2] + b[5]) / 2, hx = (b[3] - b[0]) / 2, hy = (b[4] - b[1]) / 2, hz = (b[5] - b[2]) / 2;
    const v0x = V[0] - cx2, v0y = V[1] - cy2, v0z = V[2] - cz2, v1x = V[3] - cx2, v1y = V[4] - cy2, v1z = V[5] - cz2, v2x = V[6] - cx2, v2y = V[7] - cy2, v2z = V[8] - cz2;
    if (Math.min(v0x, v1x, v2x) > hx || Math.max(v0x, v1x, v2x) < -hx) return false;
    if (Math.min(v0y, v1y, v2y) > hy || Math.max(v0y, v1y, v2y) < -hy) return false;
    if (Math.min(v0z, v1z, v2z) > hz || Math.max(v0z, v1z, v2z) < -hz) return false;
    const E = [[v1x - v0x, v1y - v0y, v1z - v0z], [v2x - v1x, v2y - v1y, v2z - v1z], [v0x - v2x, v0y - v2y, v0z - v2z]];
    for (const [ex, ey, ez] of E) {
      if (axisSep(0, -ez, ey, hx, hy, hz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z)) return false;
      if (axisSep(ez, 0, -ex, hx, hy, hz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z)) return false;
      if (axisSep(-ey, ex, 0, hx, hy, hz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z)) return false;
    }
    const [ax, ay, az] = E[0], [bx, by, bz] = E[1];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const d = nx * v0x + ny * v0y + nz * v0z, r = hx * Math.abs(nx) + hy * Math.abs(ny) + hz * Math.abs(nz);
    return Math.abs(d) <= r;
  };
  // the y of the triangle V over (x, z), or null
  const triY = (x, z) => {
    const x0 = V[0], z0 = V[2], x1 = V[3], z1 = V[5], x2 = V[6], z2 = V[8];
    const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2); if (Math.abs(d) < 1e-12) return null;
    const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d, l2 = 1 - l0 - l1;
    if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) return null;
    return l0 * V[1] + l1 * V[4] + l2 * V[7];
  };
  const stamp = new Int32Array(triTotal); let stampN = 0;
  // does any solid triangle that is not part `self` (mesh m, piece k) touch box b?
  const touchesTri = (b, m, k) => {
    stampN++;
    const i0 = Math.max(0, Math.floor((b[0] - X0) / CS)), i1 = Math.min(NX - 1, Math.floor((b[3] - X0) / CS));
    const j0 = Math.max(0, Math.floor((b[2] - Z0) / CS)), j1 = Math.min(NZ - 1, Math.floor((b[5] - Z0) / CS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * NX + i;
      for (let q = cnt[c]; q < cnt[c + 1]; q++) {
        const gid = cellTris[q]; if (stamp[gid] === stampN) continue; stamp[gid] = stampN;
        const mm = triMesh[gid];
        if (mm === m && statics[mm].tc && statics[mm].tc[gid - statics[mm].base] === k) continue;
        const M = triVerts(gid);
        if (triBox(b)) return M.label;
      }
    }
    return null;
  };
  const istamp = new Int32Array(insts.length); let istampN = 0;
  const touchesInst = (b, self) => {
    istampN++;
    const i0 = Math.max(0, Math.floor((b[0] - X0) / CS)), i1 = Math.min(NX - 1, Math.floor((b[3] - X0) / CS));
    const j0 = Math.max(0, Math.floor((b[2] - Z0) / CS)), j1 = Math.min(NZ - 1, Math.floor((b[5] - Z0) / CS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * NX + i;
      for (let q = icnt[c]; q < icnt[c + 1]; q++) {
        const k = cellInst[q]; if (k === self || istamp[k] === istampN) continue; istamp[k] = istampN;
        const o = insts[k].b;
        if (o[0] <= b[3] && o[3] >= b[0] && o[1] <= b[4] && o[4] >= b[1] && o[2] <= b[5] && o[5] >= b[2]) return insts[k].label;
      }
    }
    return null;
  };
  // the highest surface at or under y at (x, z): ground levels and triangles (not the part itself)
  const below = (x, z, y, m, k) => {
    let best = -Infinity, what = null;
    const tr = S.terrainAt(x, z); if (tr !== null && tr <= y + 0.01 && tr > best) { best = tr; what = 'terrain'; }
    const si = S.surfaceInfoAt ? S.surfaceInfoAt(x, z, 0.05) : null; if (si && isFinite(si.y) && si.y <= y + 0.01 && si.y > best) { best = si.y; what = 'surface:' + si.kind; }
    const i = Math.floor((x - X0) / CS), j = Math.floor((z - Z0) / CS);
    if (i >= 0 && i < NX && j >= 0 && j < NZ) {
      const c = j * NX + i;
      for (let q = cnt[c]; q < cnt[c + 1]; q++) {
        const gid = cellTris[q], mm = triMesh[gid];
        if (mm === m && statics[mm].tc && statics[mm].tc[gid - statics[mm].base] === k) continue;
        const M = triVerts(gid); const ty = triY(x, z);
        if (ty !== null && ty <= y + 0.01 && ty > best) { best = ty; what = M.label; }
      }
    }
    return [best, what];
  };
  const groundAt = (x, z) => {
    const tr = S.terrainAt(x, z); const si = S.surfaceInfoAt ? S.surfaceInfoAt(x, z, 0.05) : null;
    const sy = si && isFinite(si.y) ? si.y : null;
    return { tr, sy, g: tr === null ? sy : sy !== null && sy - tr <= 3 ? Math.max(tr, sy) : tr };
  };
  const groundSupports = (b) => {
    const pts = [[(b[0] + b[3]) / 2, (b[2] + b[5]) / 2], [b[0], b[2]], [b[3], b[2]], [b[0], b[5]], [b[3], b[5]]];
    for (const [x, z] of pts) {
      const tr = S.terrainAt(x, z); if (tr === null) return 'unloaded';
      if (b[1] <= tr + TOL) return 'terrain';
      const si = S.surfaceInfoAt ? S.surfaceInfoAt(x, z, 0.05) : null;
      if (si && isFinite(si.y) && b[1] <= si.y + TOL && b[1] >= si.y - 3) return 'surface';
    }
    return null;
  };
  await yieldF();
  // ------------------------------------------------------------------ the parts and their checks
  const F = [];
  const r2 = (v) => Math.round(v * 100) / 100;
  const isPost = (b) => { const h = b[4] - b[1], w = Math.max(b[3] - b[0], b[5] - b[2]); return h >= 1.2 && w <= 0.8 && h >= 3 * w; };
  let nParts = 0, nChecked = 0, tLast = performance.now();
  const checkPart = async (b, m, k, label, family, inst, ntri) => {
    nParts++;
    if (b[3] < X0 || b[0] > X1 || b[5] < Z0 || b[2] > Z1) return;
    const cxp = (b[0] + b[3]) / 2, czp = (b[2] + b[5]) / 2;
    if (Math.hypot(cxp - cx, czp - cz) > R) return;
    nChecked++;
    const h = b[4] - b[1], sz = Math.max(b[3] - b[0], b[5] - b[2]);
    // the bottom slab, grown
    const q = [b[0] - TOL, b[1] - TOL, b[2] - TOL, b[3] + TOL, b[1] + Math.min(TOL, Math.max(0.02, h)), b[5] + TOL];
    let sup = groundSupports(b);
    if (sup === 'unloaded') return;
    if (!sup) sup = touchesTri(q, m, k);
    if (!sup) sup = touchesInst(q, inst);
    if (!sup) {
      const [by, what] = below(cxp, czp, b[1] - 0.001, m, k);
      const gap = isFinite(by) ? b[1] - by : null;
      // attached anywhere else (its top or a side within TOL of other geometry: a sign on a mast arm, a lamp head under
      // its arm, a panel on a wall)? Then it hangs: reported apart unless it is an upright piece whose foot is in the air
      const q2 = [b[0] - TOL, b[1] - TOL, b[2] - TOL, b[3] + TOL, b[4] + TOL, b[5] + TOL];
      const att = touchesTri(q2, m, k) || touchesInst(q2, inst);
      const post = isPost(b);
      const si0 = S.surfaceInfoAt ? S.surfaceInfoAt(cxp, czp, 0.05) : null;
      const inner = !si0 && sz < 1.2 && h < 1.5 && gap !== null && gap < 7;   // a display or a sign inside a shop window
      if (gap === null || gap > TOL) F.push({ kind: post ? 'post' : att ? 'hang' : inner ? 'inner' : 'float', hang: !post && (!!att || inner || HANG.test(label)), att: att || undefined, label, piece: k, inst: inst >= 0 ? insts[inst].i : undefined, at: [r2(cxp), r2(b[1]), r2(czp)], size: [r2(b[3] - b[0]), r2(h), r2(b[5] - b[2])], gap: gap === null ? null : r2(gap), under: what, tris: ntri });
    }
    // sunk: the bottom far under the ground at the centre, the top above it (small things only)
    // (building parts, the street surface and the dresser's plinths go under the grade by design: props, life, vehicles,
    // walkers and trees only)
    if (h < 4 && sz < 12 && !/(Base|footing|pedestal|precast|pier|found)/i.test(label) && !/^(fk|sk|nyc|tile|ar33vk|ar32)/.test(family)) {
      const G = groundAt(cxp, czp);
      if (G.g !== null && b[1] < G.g - TOL && b[4] > G.g + 0.05) {
        // a part that only dips at one end on a slope is fine: all five points must be over its bottom by TOL
        let all = true;
        for (const [x, z] of [[b[0], b[2]], [b[3], b[2]], [b[0], b[5]], [b[3], b[5]]]) { const g2 = groundAt(x, z).g; if (g2 === null || g2 < b[1] + TOL) { all = false; break; } }
        if (all) F.push({ kind: 'sunk', label, piece: k, inst: inst >= 0 ? insts[inst].i : undefined, at: [r2(cxp), r2(b[1]), r2(czp)], size: [r2(b[3] - b[0]), r2(h), r2(b[5] - b[2])], depth: r2(G.g - b[1]), ground: r2(G.g), tris: ntri });
      }
    }
    // pierce: an upright piece's centre line through another family's near-horizontal face
    // only where the piece stands in the open (a paved or planted surface under its centre, not inside a footprint): a
    // member that goes down through a roof into its building is hidden
    const open = (() => { const si = S.surfaceInfoAt ? S.surfaceInfoAt(cxp, czp, 0.05) : null; return !!si && Math.abs(si.y - b[1]) < 2.5; })();
    if (open && (isPost(b) || /Trunk/.test(label)) && !NOSOLID.test(label)) {
      const ytop = /Trunk/.test(label) ? Math.min(b[4], b[1] + 5) : b[4];
      const i = Math.floor((cxp - X0) / CS), j = Math.floor((czp - Z0) / CS);
      if (i >= 0 && i < NX && j >= 0 && j < NZ) {
        const c = j * NX + i;
        for (let qq = cnt[c]; qq < cnt[c + 1]; qq++) {
          const gid = cellTris[qq], mm = triMesh[gid], M = statics[mm];
          if (M.ground || M.fam === family || !M.solid || M.fam === 'sk' || M.fam === 'vg36') continue;
          triVerts(gid); const ty = triY(cxp, czp);
          if (ty === null || ty < b[1] + TOL || ty > ytop - TOL) continue;
          // near-horizontal faces only (|ny| > 0.5)
          const ax = V[3] - V[0], ay = V[4] - V[1], az = V[5] - V[2], bx = V[6] - V[0], by2 = V[7] - V[1], bz = V[8] - V[2];
          const nx = ay * bz - az * by2, ny = az * bx - ax * bz, nz = ax * by2 - ay * bx, nl = Math.hypot(nx, ny, nz) || 1;
          if (Math.abs(ny) / nl < 0.5) continue;
          F.push({ kind: 'pierce', label, piece: k, inst: inst >= 0 ? insts[inst].i : undefined, at: [r2(cxp), r2(ty), r2(czp)], size: [r2(b[3] - b[0]), r2(h), r2(b[5] - b[2])], through: M.label, above: r2(ytop - ty), tris: ntri });
          break;
        }
      }
    }
    if (open && (isPost(b) || /Trunk/.test(label)) && !NOSOLID.test(label)) {
      const r0 = /Trunk/.test(label) ? 0.12 : Math.min(0.08, (b[3] - b[0]) / 2);
      const qc = [cxp - r0, b[1] + 0.6, czp - r0, cxp + r0, Math.min(b[4] - 0.3, b[1] + 4.5), czp + r0];
      if (qc[4] > qc[1]) {
        stampN++;
        const i0 = Math.max(0, Math.floor((qc[0] - X0) / CS)), i1 = Math.min(NX - 1, Math.floor((qc[3] - X0) / CS));
        const j0 = Math.max(0, Math.floor((qc[2] - Z0) / CS)), j1 = Math.min(NZ - 1, Math.floor((qc[5] - Z0) / CS));
        let hit = null;
        for (let j = j0; j <= j1 && !hit; j++) for (let i = i0; i <= i1 && !hit; i++) {
          const c = j * NX + i;
          for (let q = cnt[c]; q < cnt[c + 1]; q++) {
            const gid = cellTris[q]; if (stamp[gid] === stampN) continue; stamp[gid] = stampN;
            const M = statics[triMesh[gid]];
            if (M.ground || !M.solid || M.fam === family || M.fam === 'sk' || M.fam === 'vg36') continue;
            triVerts(gid); if (triBox(qc)) { hit = M.label; break; }
          }
        }
        if (hit) F.push({ kind: 'clash', label, piece: k, inst: inst >= 0 ? insts[inst].i : undefined, at: [r2(cxp), r2(b[1]), r2(czp)], size: [r2(b[3] - b[0]), r2(h), r2(b[5] - b[2])], through: hit, above: 1, tris: ntri });
      }
    }
    if (performance.now() - tLast > 40) { await yieldF(); tLast = performance.now(); }
  };
  for (let m = 0; m < statics.length; m++) {
    const M = statics[m]; if (M.ground || !M.solid || M.transp || !M.cb) continue;
    for (let k = 0; k < M.nc; k++) {
      const o7 = k * 7, b = [M.cb[o7], M.cb[o7 + 1], M.cb[o7 + 2], M.cb[o7 + 3], M.cb[o7 + 4], M.cb[o7 + 5]];
      await checkPart(b, m, k, M.label, M.fam, -1, M.cb[o7 + 6]);
    }
  }
  for (let k = 0; k < insts.length; k++) { const P = insts[k]; if (!P.solid || P.transp) continue; await checkPart(P.b, -1, -1, P.label, P.fam, k, 0); }
  // ------------------------------------------------------------------ report
  const byKind = {}, byLabel = {};
  for (const f of F) { byKind[f.kind] = (byKind[f.kind] || 0) + 1; const key = f.kind + ' ' + f.label.replace(/\d+_-?\d+/g, '#'); byLabel[key] = (byLabel[key] || 0) + 1; }
  const score = (f) => f.kind === 'post' ? 100 + (f.gap || 0) * f.size[1] : (f.kind === 'float' || f.kind === 'hang') ? (f.gap || 0) * Math.max(f.size[0], f.size[1], f.size[2]) : f.kind === 'sunk' ? f.depth * 2 : f.above;
  F.sort((a, b) => score(b) - score(a));
  const keepHang = A.keepHang === true;
  const list = F.filter((f) => keepHang || !f.hang).slice(0, A.top || 120);
  const hangList = F.filter((f) => f.hang).slice(0, A.topHang || 30);
  return {
    c: [r2(cx), r2(cz)], r: R, statics: statics.length, insts: insts.length, tris: triTotal, parts: nParts, checked: nChecked,
    ms: Math.round(performance.now() - T0), byKind, byLabel: Object.entries(byLabel).sort((a, b) => b[1] - a[1]).slice(0, 60), list, hangList,
  };
})()
