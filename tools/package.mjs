#!/usr/bin/env node
// -----------------------------------------------------------------------------
// tools/package.mjs — assemble the Valdrada SHIP PACKAGE
//
// Runs the Vite production build of client/ and assembles `dist-package/`
// with ONLY what the shipped app touches at runtime: the built JS/CSS/HTML plus
// the public/ asset trees the code actually fetches, a self-contained static
// server (`serve.mjs` + `start.cmd` / `start.sh`) and README-RUN.md.
//
// Deliberately NOT packaged: client/data/ (raw NYC Open Data downloads and
// the tiles_* staging sets), refs/ (Street View reference panoramas — Google
// imagery, reference use only, never redistributed), docs/, shots/,
// screenshots/, review/, admusic/, node_modules/, tools/pipeline/, *.log.
//
//   node tools/package.mjs                     build + assemble dist-package/
//   node tools/package.mjs --zip               ... and zip it (bsdtar/PowerShell)
//   node tools/package.mjs --verify            ... then serve it and shoot 1 frame
//   node tools/package.mjs --skip-build        reuse an existing client/dist
//   node tools/package.mjs --link              hardlink assets instead of copying
//                                              (instant, same volume only — the
//                                              package then shares bytes with
//                                              public/ and must not be edited)
//   node tools/package.mjs --assets settings,basis     subset of public/ (smoke tests)
//   node tools/package.mjs --out D:/ship       output directory
//   node tools/package.mjs --port 8231         port used by --verify / printed hints
//   node tools/package.mjs --content-only      app + assets only, no static-server runner (the Electron
//                                              release, server/build.mjs, serves Content/ itself)
//
// The app fetches `/settings/graphics.json` with a LEADING SLASH, so the package
// must be served from a server ROOT, not a sub-path. See README-RUN.md.
// -----------------------------------------------------------------------------
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bdir = path.join(root, 'client');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, def = null) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const outDir = path.resolve(root, opt('out', 'dist-package'));
const buildDir = path.join(bdir, 'dist');
const publicDir = path.join(bdir, 'public');
const doZip = flag('zip');
const doVerify = flag('verify');
const skipBuild = flag('skip-build');
const useLink = flag('link');
const contentOnly = flag('content-only');
const port = Number(opt('port', '8231'));

// Every public/ subtree the runtime actually reaches for. Keep in sync with the
// fetch sites listed beside each entry — the guard below shouts if public/ grows
// a directory nobody has classified yet.
const RUNTIME_ASSETS = [
  ['tiles', 'streamed by `src/world/streamer.js` — `manifest.json`, `bridges.json`, the near tile and far macro `.bin` files'],
  ['textures', 'the PBR bank read by `src/world/materials.js` (KTX2 with a JPG fallback), the baked city AO, and the HDRI skies `src/world/sky.js` relights from'],
  ['data', '`src/city/campus.js` — the Columbia campus micro-map; `src/city/landmarks.js` — LOD2 landmark meshes (`?lm3d=1`)'],
  ['luts', 'colour-grade cubes applied by `src/world/weather.js`'],
  ['settings', 'boot graphics settings loaded by `src/main.js`'],
  ['models', 'the CARLA glTF vehicle and prop fleet used by `src/sim/vehicles.js` and `src/city/props.js`'],
  ['basis', 'the KTX2/BasisU transcoder, pointed at by `KTX2Loader.setTranscoderPath` in `src/world/materials.js`'],
  ['fonts', 'Inter (SIL OFL, OFL.txt beside it) for the perception panel captions in `src/perception/segRender.js`'],
];
const assetFilter = opt('assets') ? new Set(opt('assets').split(',').map((s) => s.trim())) : null;

const MB = (b) => (b / 1048576).toFixed(1);
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- fs helpers
async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// copy (or hardlink) a whole tree; returns { files, bytes }
async function copyTree(src, dest, { link = false } = {}) {
  const files = await walk(src);
  let bytes = 0;
  const dirs = new Set(files.map((f) => path.dirname(path.join(dest, path.relative(src, f)))));
  for (const d of dirs) await fs.mkdir(d, { recursive: true });
  const CONC = 12;
  let i = 0;
  const worker = async () => {
    for (;;) {
      const n = i++;
      if (n >= files.length) return;
      const f = files[n];
      const to = path.join(dest, path.relative(src, f));
      const st = await fs.stat(f);
      bytes += st.size;
      await fs.rm(to, { force: true });
      if (link) {
        try { await fs.link(f, to); continue; } catch { /* cross-volume → copy */ }
      }
      await fs.copyFile(f, to);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  return { files: files.length, bytes };
}

async function treeSize(dir) {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  const files = await walk(dir);
  let bytes = 0;
  for (const f of files) bytes += (await fs.stat(f)).size;
  return { files: files.length, bytes };
}

// ---------------------------------------------------------------- 1. build
async function viteBuild() {
  const viteEntry = path.join(bdir, 'node_modules', 'vite', 'dist', 'node', 'index.js');
  if (!existsSync(viteEntry)) throw new Error(`vite not installed in ${bdir} — run npm install there`);
  const { build } = await import(pathToFileURL(viteEntry).href);
  log('· vite build (publicDir disabled — public/ is copied selectively below)');
  const t0 = Date.now();
  await build({
    root: bdir,
    configFile: path.join(bdir, 'vite.config.js'),
    // The 2.9 GB public/ tree must NOT go through Vite's copier: this script
    // places it, so the build stays a few seconds instead of a few minutes.
    publicDir: false,
    logLevel: 'warn',
    build: { outDir: 'dist', emptyOutDir: true },
  });
  log(`  build ok in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${path.relative(root, buildDir)}`);
}

// ---------------------------------------------------------------- 2. runner
const SERVE_MJS = `// Valdrada ship package — self-contained static server (no dependencies).
//
//   node serve.mjs [port] [host]      default 8231 127.0.0.1
//
// The app fetches /settings/graphics.json with a leading slash, so this package
// must be served from the server ROOT. Any static host works (nginx, Caddy,
// python -m http.server, S3 + CloudFront); this script only exists so the
// package runs with nothing installed but Node.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8231);
const host = process.argv[3] || process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.basis': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'image/vnd.radiance',
  '.cube': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch { res.writeHead(400); res.end('bad request'); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  // never serve outside the package
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    // hashed build assets are immutable; tiles/textures are big and stable
    const immutable = p.startsWith('/assets/') || /\\.(ktx2|bin|hdr|glb|cube)$/.test(p);
    const head = {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': immutable ? 'public, max-age=604800' : 'no-cache',
    };
    if (req.method === 'HEAD') { res.writeHead(200, head); res.end(); return; }
    res.writeHead(200, head);
    const s = fs.createReadStream(file);
    s.on('error', () => res.destroy());
    s.pipe(res);
  });
}).listen(port, host, () => {
  console.log(\`Valdrada — serving \${root}\`);
  console.log(\`open http://\${host}:\${port}/\`);
});
`;

const START_CMD = `@echo off
rem Valdrada ship package — Windows launcher
setlocal
set PORT=%1
if "%PORT%"=="" set PORT=8231
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required and was not found on PATH.
  echo Download it from https://nodejs.org/ and re-run start.cmd
  exit /b 1
)
start "" http://127.0.0.1:%PORT%/
node "%~dp0serve.mjs" %PORT%
`;

const START_SH = `#!/bin/sh
# Valdrada ship package — macOS/Linux launcher
PORT="\${1:-8231}"
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ is required and was not found on PATH."; exit 1; }
echo "open http://127.0.0.1:$PORT/"
exec node "$(dirname "$0")/serve.mjs" "$PORT"
`;

function readmeRun(manifest) {
  const rows = manifest.folders
    .map((f) => `| \`${f.name}\` | ${f.files.toLocaleString('en-US')} | ${MB(f.bytes)} MB | ${f.what} |`)
    .join('\n');
  return `# Valdrada — how to run this package

A real-time, photorealistic digital twin of New York City (Manhattan, Bronx,
Brooklyn, Queens) built from public NYC Open Data. This folder is the **runtime
package**: the compiled application plus the assets it streams. No build step,
no \`npm install\`, no network access required.

Package built ${manifest.built} · ${manifest.totals.files.toLocaleString('en-US')} files · ${MB(manifest.totals.bytes)} MB

## Requirements

- **Node.js 20+** — only to run the bundled static server. Any static file host
  works instead (see *Serving it properly* below).
- A **WebGL2** browser (Chrome/Edge 113+, Firefox 115+, Safari 17+) on a
  discrete GPU. Reference hardware: RTX 3060 Laptop at 1760x990 → ~50 fps.
  Expect ~3-4 GB of VRAM in use at street level.

## Start it

Windows:

    start.cmd                 (or: start.cmd 9000 to pick a port)

macOS / Linux:

    sh start.sh               (or: sh start.sh 9000)

Either way, or by hand:

    node serve.mjs 8231

then open <http://127.0.0.1:8231/> and **click the canvas** to lock the pointer.
You start as a flying drone. First load streams a few hundred MB of tiles and
takes 30-90 s on a cold cache.

## Controls

| Input | Action |
|---|---|
| WASD | move |
| Mouse | look |
| Shift | rise |
| Ctrl | descend |
| Tab | switch drone <-> first-person ground view |
| G | live graphics / weather editor |
| T | time of day: day, golden, dusk, night |
| R | toggle rain |
| 1-6 | teleport: Columbia, Harlem 125th, Times Sq, Midtown 34th, Civic Center, Wall St |
| H | toggle help |

URL flags: \`?spawn=harlem\`, \`?time=night\`, \`?fly=1\` debug free-cam,
\`?nosim=1\` no traffic/pedestrians, \`?nofar=1\` hide far LoD, \`?nodress=1\`
disable the close-range building dresser, \`?nopost=1\` no post chain,
\`?hud=0\` clean plate (no overlay), \`?tiles=<base url>\` stream tiles from
somewhere else, \`?play=1\` the legacy grapple-traversal character.

## Serving it properly

One hard requirement: **the package must sit at the server root.** The app
fetches \`/settings/graphics.json\` with a leading slash, so hosting it under
\`/valdrada/\` breaks the boot settings. Everything else is relative
(\`base: './'\`), so a root-mounted bucket or vhost works unchanged.

Recommendations for a public deployment:

- Serve \`tiles/\`, \`textures/\`, \`models/\` and \`assets/\` with a long
  \`Cache-Control\` (they are content-stable); keep \`index.html\` uncached.
- Enable HTTP/2 or HTTP/3: the streamer opens many small \`.bin\` requests.
- Do **not** gzip \`*.bin\`, \`*.ktx2\`, \`*.glb\` or \`*.hdr\` — already compact,
  and compressing them costs CPU for ~nothing.
- Total transfer for a full four-borough fly-around is a few hundred MB; the
  whole tile set is ${MB(manifest.folders.find((f) => f.name === 'tiles')?.bytes || 0)} MB.

## What is in here

| folder | files | size | what it is |
|---|---:|---:|---|
${rows}

\`PACKAGE-MANIFEST.json\` carries the same numbers machine-readably, plus the
list of built entry files.

## Not in here

Reference imagery (\`refs/streetview\`, Google Street View panoramas used only
for visual comparison during development) is **not redistributed**. The raw NYC
Open Data downloads, the tile-compiler staging sets, development screenshots and
the research notes are not part of the runtime and live in the source repository.

## Licence

Code: MIT, Copyright (c) 2026 Mehmet Kerem Turkcan (\`LICENSE\`). Data: under the terms of the
sources it derives from (NYC Open Data terms / public domain, OpenStreetMap
ODbL, Poly Haven and ambientCG CC0, CARLA assets CC-BY 4.0, ez-tree MIT). See
the repository's \`README.md\` and \`client/DATA_SOURCES.md\`.

Valdrada is developed and maintained by
Mehmet Kerem Turkcan. If you use it, the compiled city or imagery rendered
with it, please cite Valdrada itself:

    M. K. Turkcan. "Valdrada: a real-data, real-time digital twin of New
    York City." Software, version 0.6.1, 2026.
    https://github.com/mkturkcan/valdrada
`;
}

// ---------------------------------------------------------------- 3. zip
function makeZip(dir, zipPath) {
  const bsdtar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  // Windows ships bsdtar (libarchive), which writes real ZIPs with -a; GNU tar
  // does not, so on other platforms prefer `zip`.
  const attempts = process.platform === 'win32'
    ? [[bsdtar, ['-a', '-c', '-f', zipPath, '-C', dir, '.']],
       ['powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${dir}\\*' -DestinationPath '${zipPath}' -Force`]]]
    : [['zip', ['-r', '-q', zipPath, '.']], ['tar', ['-a', '-c', '-f', zipPath, '-C', dir, '.']]];
  for (const [cmd, args] of attempts) {
    log(`· zipping with ${path.basename(cmd)} (this takes a while for GB-scale packages)`);
    const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: dir });
    if (!r.error && r.status === 0 && existsSync(zipPath)) return true;
    log(`  ${path.basename(cmd)} failed (${r.error?.code || 'exit ' + r.status}) — trying the next archiver`);
  }
  return false;
}

// ---------------------------------------------------------------- 4. verify
async function verify(pkgDir) {
  log(`· verify: serving the package on :${port} and shooting one frame with tools/bshot.mjs`);
  const server = spawn(process.execPath, [path.join(pkgDir, 'serve.mjs'), String(port)], { stdio: 'ignore', detached: false });
  await new Promise((r) => setTimeout(r, 1200));
  const shotDir = path.join(root, 'client', 'shots', 'package');
  const r = spawnSync(process.execPath, [
    path.join(root, 'tools', 'bshot.mjs'),
    '--views', 'columbia', '--time', 'day', '--port', String(port),
    '--flags', 'hud=0', '--out', shotDir, '--label', 'pkg',
  ], { stdio: 'inherit', cwd: root });
  server.kill();
  const files = existsSync(shotDir) ? await fs.readdir(shotDir) : [];
  const bad = files.filter((f) => f.includes('_INVALID'));
  const good = files.filter((f) => f.endsWith('.png') && !f.includes('_INVALID'));
  log(`  frames: ${good.length} valid, ${bad.length} INVALID  (${shotDir})`);
  if (r.status !== 0 || bad.length || !good.length) {
    log('  VERIFY FAILED — the package did not render a valid frame');
    return false;
  }
  log('  VERIFY OK');
  return true;
}

// ---------------------------------------------------------------- main
(async () => {
  log(`Valdrada packager\n  repo   ${root}\n  output ${outDir}\n`);

  if (!skipBuild) await viteBuild();
  else log('· skipping vite build (--skip-build)');
  if (!existsSync(path.join(buildDir, 'index.html'))) {
    throw new Error(`no build output at ${buildDir} — run without --skip-build`);
  }

  // fresh output dir (never delete anything else)
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const folders = [];

  // 4a. the built app
  const app = await copyTree(buildDir, outDir, { link: useLink });
  folders.push({ name: 'assets/ + index.html', files: app.files, bytes: app.bytes, what: 'the built application — Vite output: index.html plus hashed JS/CSS chunks' });
  log(`· app        ${String(app.files).padStart(6)} files ${MB(app.bytes).padStart(9)} MB`);

  // 4b. runtime asset trees
  const known = new Set(RUNTIME_ASSETS.map(([n]) => n));
  for (const e of await fs.readdir(publicDir, { withFileTypes: true })) {
    if (e.isDirectory() && !known.has(e.name)) {
      log(`  ! public/${e.name} is not classified in RUNTIME_ASSETS — NOT packaged. Classify it in tools/package.mjs.`);
    }
  }
  for (const [name, what] of RUNTIME_ASSETS) {
    if (assetFilter && !assetFilter.has(name)) { log(`· ${name.padEnd(10)} skipped (--assets)`); continue; }
    const src = path.join(publicDir, name);
    if (!existsSync(src)) { log(`  ! public/${name} missing — skipped`); continue; }
    const t0 = Date.now();
    const st = await copyTree(src, path.join(outDir, name), { link: useLink });
    folders.push({ name, files: st.files, bytes: st.bytes, what });
    log(`· ${name.padEnd(10)} ${String(st.files).padStart(6)} files ${MB(st.bytes).padStart(9)} MB  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // 4c. the runner (not in a --content-only build: the Electron server serves Content/ itself)
  if (!contentOnly) {
    await fs.writeFile(path.join(outDir, 'serve.mjs'), SERVE_MJS);
    await fs.writeFile(path.join(outDir, 'start.cmd'), START_CMD.replace(/\n/g, '\r\n'));
    await fs.writeFile(path.join(outDir, 'start.sh'), START_SH);
    await fs.writeFile(path.join(outDir, 'package.json'), JSON.stringify({
      name: 'valdrada-runtime',
      private: true,
      version: '1.0.0',
      description: 'Valdrada — NYC digital twin, runtime package (built app + streamed assets)',
      type: 'module',
      scripts: { start: 'node serve.mjs' },
    }, null, 2) + '\n');
  }

  // 4d. manifest + README-RUN
  const entryFiles = (await walk(buildDir)).map((f) => path.relative(buildDir, f).split(path.sep).join('/'));
  const totals = folders.reduce((a, f) => ({ files: a.files + f.files, bytes: a.bytes + f.bytes }), { files: 0, bytes: 0 });
  const manifest = {
    name: 'Valdrada runtime package',
    built: new Date().toISOString().slice(0, 19).replace('T', ' ') + 'Z',
    node: process.version,
    hardlinked: useLink,
    assetsIncluded: folders.map((f) => f.name),
    folders,
    totals,
    build: { files: entryFiles.sort() },
    servedAtRoot: true,
    notes: [
      'The app fetches /settings/graphics.json absolutely — serve this package at the server root.',
      'Excluded by design: data/raw, data/tiles_* staging sets, refs/ (Street View panoramas, not redistributable), docs/, shots/, screenshots/, review/, admusic/, node_modules, tools/pipeline, *.log.',
    ],
  };
  await fs.writeFile(path.join(outDir, 'PACKAGE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!contentOnly) await fs.writeFile(path.join(outDir, 'README-RUN.md'), readmeRun(manifest));

  const meta = await treeSize(outDir);
  log('\n---------------------------------------------------------------');
  log(`package: ${meta.files.toLocaleString('en-US')} files, ${MB(meta.bytes)} MB  (${(meta.bytes / 1073741824).toFixed(2)} GB)`);
  for (const f of folders) log(`  ${f.name.padEnd(20)} ${String(f.files).padStart(6)} files ${MB(f.bytes).padStart(10)} MB`);
  log('---------------------------------------------------------------');
  log(`run it:  node ${path.relative(root, path.join(outDir, 'serve.mjs'))} ${port}`);

  if (doZip) {
    const zipPath = outDir + '.zip';
    await fs.rm(zipPath, { force: true });
    if (makeZip(outDir, zipPath)) {
      const st = await fs.stat(zipPath);
      log(`zip: ${path.relative(root, zipPath)}  ${MB(st.size)} MB`);
    } else {
      log('zip: FAILED — no working archiver found (tried bsdtar/PowerShell or zip/tar)');
      process.exitCode = 1;
    }
  }

  if (doVerify) {
    const ok = await verify(outDir);
    if (!ok) process.exitCode = 1;
  }
})().catch((e) => {
  console.error('packager failed:', e);
  process.exit(1);
});
