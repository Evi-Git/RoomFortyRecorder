// Opens the Logs explorer in Chromium and checks a few things. Exits 1 on failure.
import fs from 'node:fs';
import path from 'node:path';
import { resolveTool } from './build.mjs';
import { serve } from './serve.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const out = arg('out', '/tmp/rf-harness-out');
const log = arg('log');
const shots = arg('shots', path.join(out, 'shots'));
const port = Number(arg('port', 4173));
if (!log) {
  console.error(
    'usage: smoke.mjs --log <pull.log.gz> [--shots dir] [--out dir]',
  );
  process.exit(2);
}
fs.mkdirSync(shots, { recursive: true });

const { chromium } = resolveTool('playwright');
const server = await serve({ out, log, port });
const browser = await chromium.launch();
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`,
  );
  if (!ok) failures.push(name);
};
const pageErrors = [];
const consoleErrors = [];

try {
  const ctx = await browser.newContext({
    locale: 'en-GB',
    viewport: { width: 1500, height: 1000 },
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/?entry=logs-explorer`);

  // Loaded when the loading state is gone and the table has rows.
  await page
    .waitForSelector('[data-state="loading"]', { timeout: 15000 })
    .catch(() => {});
  await page.waitForSelector('[data-state="loading"]', {
    state: 'detached',
    timeout: 120000,
  });
  await page.waitForSelector('[data-state="failed"], table tbody tr', {
    timeout: 60000,
  });
  await page.screenshot({ path: path.join(shots, '1-loaded.png') });
  check(
    'pull loaded (no failed state)',
    (await page.locator('[data-state="failed"]').count()) === 0,
  );

  const rows = await page.locator('table tbody tr').count();
  check(
    'Damage Done shows at least 10 raider rows',
    rows >= 10,
    `${rows} rows`,
  );

  await page
    .getByRole('button', { name: 'Enemies', exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Healing', exact: true })
    .first()
    .click();
  const ula = page.getByText("Blood of Ula'tek").first();
  let found = true;
  await ula.waitFor({ timeout: 15000 }).catch(() => {
    found = false;
  });
  await page.screenshot({ path: path.join(shots, '2-enemy-healing.png') });
  check('Enemies > Healing has a "Blood of Ula\'tek" row', found);
} catch (e) {
  failures.push(`script error: ${e.message}`);
  console.log(`FAIL  script error: ${e.message}`);
  try {
    const pg = browser.contexts()[0]?.pages()[0];
    if (pg) await pg.screenshot({ path: path.join(shots, 'failure.png') });
  } catch {
    // no page to shoot
  }
} finally {
  check(
    'no uncaught page errors',
    pageErrors.length === 0,
    pageErrors.join(' | '),
  );
  if (consoleErrors.length) {
    const uniq = [...new Set(consoleErrors)];
    console.log(`console errors (${consoleErrors.length}, ignored):`);
    uniq.slice(0, 10).forEach((m) => console.log(`  ${m.slice(0, 160)}`));
  }
  await browser.close();
  server.close();
}
console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'OK');
process.exit(failures.length ? 1 : 0);
