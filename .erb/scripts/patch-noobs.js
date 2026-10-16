/* eslint-disable no-console */
// [RoomFortyRecorder] Adds live streaming (WebRTC/WHIP) to the recording
// engine (`noobs`).
//
// noobs is Warcraft Recorder's native libobs binding. We install the stock
// npm release, then this script:
//   1. checks it's exactly the version our patch was written against,
//   2. copies our patched C++ sources and typings over it (native/noobs/),
//   3. recompiles noobs.node (Windows only; needs the MSVC build tools that
//      GitHub's Windows runners have),
//   4. adds OBS 31.1.1's obs-webrtc plugin next to the other OBS plugins.
//
// It is idempotent: if the installed engine already carries this exact patch
// it does nothing. Run with --verify to only check (used in CI).
//
// If an upstream merge bumps noobs, this script fails on purpose: the patch
// in native/noobs/ has to be re-applied to the new version first.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EXPECTED_VERSION = '0.0.205';

// SHA-256 of the stock files we replace, from noobs 0.0.205.
const PRISTINE = {
  'src/obs_interface.cpp': '9286fb44e288231743687ed0de6fc91e1cd082f1d4496deed138e442e1108318',
  'src/obs_interface.h': 'f786164c4a41a1639740ac40404a72abbdd27f16fd4f7c75fdbc5eb6795bd032',
  'src/main.cpp': 'db1d63e5d548926b22f9f5260629d101f01759b18a611112b2c10f6718cb8878',
  'index.d.ts': '39e5255aea9948a655ba3a73a7e2a551a109b13019852ddbdb2e21ba8ddcc24f',
};

const root = path.resolve(__dirname, '..', '..');
const patchDir = path.join(root, 'native', 'noobs');
const noobsDir = path.join(root, 'release', 'app', 'node_modules', 'noobs');
const marker = path.join(noobsDir, '.roomforty-patch');
const verifyOnly = process.argv.includes('--verify');

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (msg) => {
  console.error(`\n[patch-noobs] ERROR: ${msg}\n`);
  process.exit(1);
};

// Fingerprint of everything we apply, so a changed patch is re-applied.
const patchFiles = [...Object.keys(PRISTINE), 'obs-webrtc/obs-webrtc.dll', 'obs-webrtc/locale/en-US.ini'];
const patchHash = crypto
  .createHash('sha256')
  .update(patchFiles.map((f) => `${f}:${sha(path.join(patchDir, f))}`).join('\n'))
  .digest('hex');

if (!fs.existsSync(noobsDir)) {
  fail(`noobs is not installed at ${noobsDir}. Run npm install first.`);
}

const { version } = JSON.parse(fs.readFileSync(path.join(noobsDir, 'package.json'), 'utf8'));
if (version !== EXPECTED_VERSION) {
  fail(
    `noobs ${version} is installed, but the streaming patch in native/noobs/ was written for ${EXPECTED_VERSION}.\n` +
      'An upstream merge probably bumped noobs. Re-apply the patch to the new version (ask Claude),\n' +
      'or pin noobs back to the old version in release/app/package.json.',
  );
}

const distNode = path.join(noobsDir, 'dist', 'noobs.node');
const distPlugin = path.join(noobsDir, 'dist', 'obs-plugins', 'obs-webrtc.dll');

const isApplied = () =>
  fs.existsSync(marker) &&
  fs.readFileSync(marker, 'utf8').trim() === patchHash &&
  fs.existsSync(distPlugin) &&
  fs.existsSync(distNode) &&
  fs.readFileSync(distNode).includes('StartStream');

if (verifyOnly) {
  if (!isApplied()) fail('The installed noobs does not have the streaming patch applied.');
  console.log('[patch-noobs] OK: noobs has the streaming patch.');
  process.exit(0);
}

if (isApplied()) {
  console.log('[patch-noobs] Streaming patch already applied, nothing to do.');
  process.exit(0);
}

if (process.platform !== 'win32') {
  console.warn('[patch-noobs] Not on Windows: skipping the noobs rebuild (the app only runs on Windows).');
  process.exit(0);
}

// 1. Sources: each file must be stock or already ours, never something else.
for (const [rel, pristine] of Object.entries(PRISTINE)) {
  const installed = path.join(noobsDir, rel);
  const ours = path.join(patchDir, rel);
  const current = sha(installed);
  if (current !== pristine && current !== sha(ours)) {
    fail(`${rel} in noobs ${version} is not the stock file. Refusing to overwrite it.`);
  }
  fs.copyFileSync(ours, installed);
}
console.log('[patch-noobs] Patched sources copied.');

// 2. Rebuild noobs.node from the patched sources.
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [root] });
console.log('[patch-noobs] Compiling noobs.node (this takes a minute)...');
execFileSync(process.execPath, [nodeGyp, 'rebuild'], { cwd: noobsDir, stdio: 'inherit' });
fs.copyFileSync(path.join(noobsDir, 'build', 'Release', 'noobs.node'), distNode);

// 3. The OBS WebRTC plugin and its strings.
fs.copyFileSync(path.join(patchDir, 'obs-webrtc', 'obs-webrtc.dll'), distPlugin);
const localeDir = path.join(noobsDir, 'dist', 'data', 'obs-plugins', 'obs-webrtc', 'locale');
fs.mkdirSync(localeDir, { recursive: true });
fs.copyFileSync(path.join(patchDir, 'obs-webrtc', 'locale', 'en-US.ini'), path.join(localeDir, 'en-US.ini'));

fs.writeFileSync(marker, patchHash);

if (!isApplied()) fail('Patch applied but verification failed (noobs.node has no StartStream).');
console.log('[patch-noobs] Done: noobs now supports live streaming.');
