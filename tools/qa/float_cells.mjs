// Floating furniture per cell (BKB, 2026-10-26): the support audit (tools/qa/support_audit.js, its 'float' and 'post'
// findings) run over every listed 128 m cell in a three.js page, counted per cell, the street and roof furniture apart
// from the rest. One page for the whole list (bshot --onepage): a view per 512 m tile group, each view auditing the cells
// of its group.
//
//   node tools/qa/float_cells.mjs --cells <file|a,b,...> --out <dir> [--flags "<extra page flags>"]
//
// Writes <out>/float_cells.json ({ cell: { float, post, furniture, list } }) and prints the cells with floating furniture;
// exit 1 when any cell has one. Run it without kitrec=1: that bake-only flag records the dresser's walls as kit instances
// three.js does not draw, so every dressed roof's props would read as floating.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const spec = opt('cells'), out = path.resolve(opt('out', 'float_cells'));
if (!spec) { console.error('float_cells: --cells <file|list>'); process.exit(2); }
const cells = (spec.includes(',') || /^-?\d+_-?\d+$/.test(spec) ? spec : await fs.readFile(spec, 'utf8')).split(/[\s,]+/).filter(Boolean)
  .map((k) => k.split('_').map(Number));
await fs.mkdir(out, { recursive: true });
// a view per 512 m tile group, the camera over the group's cells
const groups = new Map();
for (const [i, j] of cells) { const g = `${Math.floor(i / 4)}_${Math.floor(j / 4)}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([i, j]); }
const cams = {};
for (const [g, cs] of groups) {
  const x = cs.reduce((a, c) => a + (c[0] + 0.5) * 128, 0) / cs.length, z = cs.reduce((a, c) => a + (c[1] + 0.5) * 128, 0) / cs.length;
  cams['fc_' + g.replace('-', 'm').replace('_-', '_m')] = [x - 40, z - 40, 60, x, z, -0.6, 70];
}
await fs.writeFile(path.join(out, 'cams.json'), JSON.stringify(cams, null, 1));
const audit = (await fs.readFile(path.join(root, 'tools/qa/support_audit.js'), 'utf8')).replace(/^\s*\/\/.*$/gm, '').trim().replace(/;\s*$/, '');
const FURN = '(^|/)(pool[A-Z]?:|signs|kit:|tw:|nyc:merge)|signal|lamp|bench|hydrant|sign|litter|mailbox|shelter|newsstand|bollard|roof|chimney|bulkhead|stack|tower';
const evalSrc = `(async () => {
  const CELLS = ${JSON.stringify(cells)}, E = window.__ENGINE, p = E.camera.position, res = {};
  window.__FC = window.__FC || new Set();
  const furn = new RegExp(${JSON.stringify(FURN)}, 'i');
  for (const [i, j] of CELLS) {
    const k = i + '_' + j, x = (i + 0.5) * 128, z = (j + 0.5) * 128;
    if (window.__FC.has(k) || Math.hypot(x - p.x, z - p.z) > 300) continue;
    window.ARG = { c: [x, z], r: 64, top: 400 };
    const d = await ${audit};
    const L = (d.list || []).filter((f) => (f.kind === 'float' || f.kind === 'post') && f.at[0] >= i * 128 && f.at[0] < (i + 1) * 128 && f.at[2] >= j * 128 && f.at[2] < (j + 1) * 128);
    const F = L.filter((f) => furn.test(f.label) && !/^bridges\\//.test(f.label));
    res[k] = { float: L.filter((f) => f.kind === 'float').length, post: L.filter((f) => f.kind === 'post').length, furniture: F.length, list: F.slice(0, 20).map((f) => [f.kind, f.label, f.at, f.size, f.gap]) };
    window.__FC.add(k);
  }
  return JSON.stringify(res);
})()`;
await fs.writeFile(path.join(out, 'eval.js'), evalSrc);
const r = spawnSync('node', [path.join(root, 'tools/bshot.mjs'), '--cams', path.join(out, 'cams.json'), '--views', Object.keys(cams).join(','), '--onepage', '1',
  '--time', 'day', '--flags', 'hud=0&terrain=p1&hhp=1&brlod=0&nosim=1&life=0' + (opt('flags') ? '&' + opt('flags') : ''), '--out', out, '--jpg', '1', '--nolock', '1',
  '--evalfile', path.join(out, 'eval.js')], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
await fs.writeFile(path.join(out, 'bshot.log'), (r.stdout || '') + (r.stderr || ''));
const all = {};
for (const line of (r.stdout || '').split('\n')) {
  const m = /eval: (.*)$/.exec(line); if (!m) continue;
  let v = JSON.parse(m[1]); if (typeof v === 'string') v = JSON.parse(v);
  Object.assign(all, v);
}
await fs.writeFile(path.join(out, 'float_cells.json'), JSON.stringify(all, null, 1));
const bad = Object.entries(all).filter(([, v]) => v.furniture > 0);
const missing = cells.map((c) => c.join('_')).filter((k) => !all[k]);
console.log(`float_cells: ${Object.keys(all).length}/${cells.length} cells audited, ${bad.length} with floating furniture${missing.length ? ', not reached: ' + missing.join(' ') : ''}`);
for (const [k, v] of bad) console.log(`  ${k}: ${v.furniture} (${v.list.slice(0, 3).map((f) => f[1].split('/').pop() + '@' + f[2].join(',')).join('; ')})`);
process.exit(bad.length || missing.length ? 1 : 0);
