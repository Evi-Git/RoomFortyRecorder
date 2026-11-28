// Measures how long the main process is blocked while the automatic backfill
// parses saved combat logs: PullLogCapture over a big synthetic log (repo test
// logs repeated), with a 10 ms timer as the "event loop lag" monitor.
//   node tools/audit/backfill-lag.mjs [--mb 200]
// Prints the longest gap between timer turns, without and with the yielding
// that PullBackfill uses (src/main/yieldToLoop.ts). Nothing is committed: the
// big log is written to the OS temp folder and removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
import { resolveTool } from '../harness/build.mjs';
const esbuild = resolveTool('esbuild');

const mb = Number(process.argv[process.argv.indexOf('--mb') + 1]) || 200;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-lag-'));

const bundle = async (entry, name) => {
  const file = path.join(out, `${name}.cjs`);
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: file,
    logLevel: 'error',
  });
  return require(file);
};

const Capture = (await bundle('src/parsing/PullLogCapture.ts', 'capture'))
  .default;
const { createYielder } = await bundle('src/main/yieldToLoop.ts', 'yield');

// Build the big log from raid logs, repeated until it is `mb` MB.
const sources = [
  'raid_wipe.txt',
  'beloren_boss_hp.txt',
  'coiled_altar_boss_hp.txt',
]
  .map((f) => path.join(root, 'tests/logs/retail', f))
  .filter((f) => fs.existsSync(f));
const big = path.join(out, 'WoWCombatLog-big.txt');
const fd = fs.openSync(big, 'w');
let written = 0;
while (written < mb * 1024 * 1024) {
  for (const s of sources) {
    const buf = fs.readFileSync(s);
    fs.writeSync(fd, buf);
    if (buf[buf.length - 1] !== 0x0a) fs.writeSync(fd, '\n');
    written += buf.length;
  }
}
fs.closeSync(fd);

const measure = async (label, useYield) => {
  let pulls = 0;
  const capture = new Capture(() => {
    pulls += 1;
  });
  const yieldNow = createYielder();
  let worst = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 10);
  const t0 = performance.now();
  let lines = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(big, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    lines += 1;
    if (useYield) await yieldNow();
    capture.onLine(line);
  }
  const total = performance.now() - t0;
  clearInterval(timer);
  console.log(
    `${label}: ${(written / 1048576).toFixed(0)} MB, ${lines} lines, ${pulls} pulls, ` +
      `took ${(total / 1000).toFixed(1)} s, longest gap between 10 ms timer turns ${worst.toFixed(0)} ms`,
  );
};

await measure('without yielding', false);
await measure('with yielding   ', true);
fs.rmSync(out, { recursive: true, force: true });
