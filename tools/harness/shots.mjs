// Walks the whole app in Chromium and saves a screenshot per scene.
//
//   node tools/harness/shots.mjs --logs <dir of pull .log.gz> --out <dir>
//        [--only name1,name2] [--keep <dir>] [--reseed] [--no-build]
//
// Builds if the sources changed, starts a local guild server seeded from the
// logs (backend.mjs), serves the app entry (serve.mjs), then runs the scenes
// in scenes.mjs. Writes <out>/<nn>-<name>.png and <out>/manifest.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, resolveTool } from './build.mjs';
import { startBackend } from './backend.mjs';
import { serve } from './serve.mjs';
import { scenes } from './scenes.mjs';
import { makeHelpers } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

const logsDir = arg('logs');
const out = path.resolve(arg('out', '/tmp/rf-harness-shots'));
const buildDir = arg('build', '/tmp/rf-harness-out');
const only = arg('only')?.split(',').filter(Boolean);
if (!logsDir) {
  console.error('usage: shots.mjs --logs <dir> --out <dir> [--only a,b] [--keep dir] [--reseed] [--no-build]');
  process.exit(2);
}

const newest = (dir) => {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
};
const built = path.join(buildDir, 'entries/app.js');
const stale =
  !fs.existsSync(built) ||
  !fs.existsSync(path.join(buildDir, 'node/pulldesk.mjs')) ||
  fs.statSync(built).mtimeMs <
    Math.max(newest(path.join(repo, 'src')), newest(here));
if (!flag('no-build') && stale) {
  console.log('building...');
  await build(buildDir);
}

fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) {
  if (/\.png$/.test(f) || f === 'manifest.json') fs.rmSync(path.join(out, f));
}

const version = JSON.parse(
  fs.readFileSync(path.join(repo, 'release/app/package.json'), 'utf8'),
).version;

const keep = arg('keep', '/tmp/rf-harness-backend-cache');
console.log('starting backend (first run seeds the logs, about a minute)...');
const backend = await startBackend({
  out: buildDir,
  logsDir,
  keep,
  reseed: flag('reseed'),
});
const server = await serve({ out: buildDir, port: 0, backend });
const port = server.address().port;
const url = `http://127.0.0.1:${port}/?entry=app`;

const { chromium } = resolveTool('playwright');
const browser = await chromium.launch();
const manifest = [];
const selected = scenes.filter((s) => !only || only.some((o) => s.name === o || s.name.includes(o)));

let ctx = null;
let page = null;
let pad = 0;
const IGNORED = /Failed to load resource|ERR_UNKNOWN_URL_SCHEME|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_TUNNEL/;
let log = { console: [], page: [], ignored: 0 };

const open = async (scene) => {
  await ctx?.close().catch(() => {});
  const vp = scene.viewport ?? { width: 1440, height: 900 };
  ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  // Nothing leaves this machine: only the harness server is reachable.
  await ctx.route(/^(?!http:\/\/127\.0\.0\.1)(https?|wss?):/, (r) => r.abort());
  await ctx.addInitScript(
    (init) => {
      window.__harnessInit = init;
    },
    { ...(scene.init ?? {}), version },
  );
  page = await ctx.newPage();
  page.on('pageerror', (e) => log.page.push(String(e).slice(0, 400)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORED.test(text) || /\[VideoPlayer\] Video Player Error/.test(text)) log.ignored += 1;
    else log.console.push(text.slice(0, 300));
  });
  await page.goto(url);
  await page.locator('div.shrink-0[class*="border-card/60"]').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
};

let n = 0;
for (const scene of selected) {
  n += 1;
  const file = `${String(n).padStart(2, '0')}-${scene.name}.png`;
  const entry = { index: n, name: scene.name, file, shows: scene.shows, status: 'ok' };
  const t0 = Date.now();
  log = { console: [], page: [], ignored: 0 };
  let failuresBefore = 0;
  try {
    if (!scene.continue || !page) await open(scene);
    else if (scene.viewport) await page.setViewportSize(scene.viewport);
    failuresBefore = await page.evaluate(() => window.__harness.failures.length);
    await scene.steps(makeHelpers(page));
    await page.waitForTimeout(scene.wait ?? 400);
  } catch (e) {
    entry.status = 'error';
    entry.error = String(e.message || e).split('\n')[0].slice(0, 300);
  }
  try {
    await page.screenshot({ path: path.join(out, file) });
    const failed = await page.evaluate(
      (from) => window.__harness.failures.slice(from),
      failuresBefore,
    );
    entry.failedActions = [...new Map(failed.map((f) => [`${f.action}:${f.error}`, f])).values()];
  } catch (e) {
    entry.status = 'error';
    entry.error ??= `screenshot failed: ${e.message}`;
  }
  entry.consoleErrors = [...new Set([...log.page.map((m) => `PAGE ${m}`), ...log.console])];
  entry.ignoredResourceErrors = log.ignored;
  entry.ms = Date.now() - t0;
  manifest.push(entry);
  console.log(`${entry.status === 'ok' ? 'ok   ' : 'ERROR'} ${file}  ${entry.ms}ms${entry.error ? `  ${entry.error}` : ''}`);
  if (scene.after) await scene.after?.(page).catch(() => {});
}

fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
server.close();
await backend.stop();
const bad = manifest.filter((m) => m.status !== 'ok').length;
console.log(`${manifest.length} scenes, ${bad} errored. ${out}/manifest.json`);
process.exit(0);
