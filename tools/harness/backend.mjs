// A real local guild server for the harness, seeded from pull logs.
//
//   node tools/harness/backend.mjs --logs <dir> [--keep <dir>] [--port N]
//
// - Starts guild-cloud-server/server.mjs as a child process on a free port
//   with a temp storage dir and dummy env (no Discord, R2 or Warcraft Logs
//   keys). `@aws-sdk` is stubbed if it is not installed (aws-stub.mjs).
// - Signs in as a fixture raider ("Harness Raider", the server's owner) with
//   a session token minted the same way the server does.
// - Seeds it by running each log through the app's own PullDesk/PullBackfill
//   code (bundled by build.mjs): scan -> claim -> upload the filtered log
//   with the app's meters line -> upload the full log.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

export const GUILD = 'Room Forty';
export const SECRET = 'harness-secret';
export const USER = { id: '100000000000000001', name: 'Harness Raider' };

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// Same HMAC scheme as server.mjs encodeToken().
export const sessionToken = (secret = SECRET) => {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      action: 'session',
      guild: GUILD,
      discordId: USER.id,
      userName: USER.name,
      iat: now,
      exp: now + 30 * 24 * 3600,
    }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
};

const waitFor = async (url, ms = 20000) => {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`${url} did not come up`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

const logFiles = (dir) =>
  dir
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.log.gz'))
        .sort()
        .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }))
    : [];

const log = (m) => console.log(`[backend] ${m}`);

/**
 * @param {{ out?: string, logsDir?: string, keep?: string, port?: number,
 *           reseed?: boolean }} opts `out` is the build dir (needs node/pulldesk.mjs).
 */
export const startBackend = async ({
  out = '/tmp/rf-harness-out',
  logsDir,
  keep,
  port,
  reseed = false,
} = {}) => {
  const files = logFiles(logsDir);
  const key = crypto
    .createHash('sha1')
    .update(JSON.stringify(files))
    .digest('hex')
    .slice(0, 10);
  // A kept dir is reused when it was seeded from the same logs.
  const root = keep
    ? path.resolve(keep)
    : await fsp.mkdtemp(path.join(os.tmpdir(), 'rf-harness-backend-'));
  const marker = path.join(root, 'seeded.json');
  let seeded = false;
  if (keep && !reseed && fs.existsSync(marker)) {
    seeded = JSON.parse(fs.readFileSync(marker, 'utf8')).key === key;
  }
  if (keep && !seeded) await fsp.rm(root, { recursive: true, force: true });
  const storage = path.join(root, 'server');
  const userData = path.join(root, 'userdata');
  const logDir = path.join(root, 'wowlogs');
  for (const d of [storage, userData, logDir]) await fsp.mkdir(d, { recursive: true });

  // People who have signed in, for the Admin page's Members list (the
  // harness user's own token is minted, not a real sign-in). Written before
  // the server starts; an existing list is left alone.
  const stateFile = path.join(storage, 'state.json');
  const saved = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  if (!saved.knownUsers || !Object.keys(saved.knownUsers).length) {
    const now = Math.floor(Date.now() / 1000);
    saved.knownUsers = {
      [USER.id]: { userName: USER.name, lastLogin: now - 600 },
      '100000000000000002': { userName: 'Fixture Raider', lastLogin: now - 3 * 3600 },
      '100000000000000003': { userName: 'Fixture Healer', lastLogin: now - 5 * 86400 },
      '100000000000000004': { userName: 'Fixture Trial', lastLogin: now - 9 * 86400 },
    };
    saved.revokedUsers = { '100000000000000004': now - 86400 };
    fs.writeFileSync(stateFile, JSON.stringify(saved));
  }

  port ??= await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    RF_HARNESS_AWS_STUB: '1',
    GUILD_CLOUD_HOST: '127.0.0.1',
    GUILD_CLOUD_PORT: String(port),
    GUILD_CLOUD_STORAGE_PATH: storage,
    GUILD_CLOUD_GUILD: GUILD,
    GUILD_CLOUD_SECRET: SECRET,
    GUILD_CLOUD_OWNER_IDS: USER.id,
  };
  const child = spawn(
    process.execPath,
    ['--import', path.join(here, 'aws-stub.mjs'), path.join(repo, 'guild-cloud-server/server.mjs')],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const serverLog = [];
  for (const s of [child.stdout, child.stderr]) {
    s.on('data', (d) => serverLog.push(String(d)));
  }
  child.on('exit', (code) => serverLog.push(`[exit ${code}]`));
  await waitFor(`${base}/health`).catch((e) => {
    throw new Error(`${e.message}\n${serverLog.join('')}`);
  });

  // The app's PullDesk, pointed at this server.
  process.env.WCR_CLOUD_API_URL = `${base}/api`;
  const mod = await import(`${pathToFileURL(path.join(out, 'node/pulldesk.mjs')).href}?${Date.now()}`);
  const st = mod.state();
  Object.assign(st, {
    apiUrl: `${base}/api`,
    guild: GUILD,
    token: sessionToken(),
    userData,
  });
  Object.assign(st.config, {
    pullDeskUpload: true,
    retailLogPath: logDir,
    storagePath: path.join(root, 'recordings'),
  });

  const backend = {
    base,
    apiUrl: `${base}/api`,
    storage,
    root,
    desk: mod,
    state: st,
    serverLog: () => serverLog.join(''),
    stop: async () => {
      child.kill();
      if (!keep) await fsp.rm(root, { recursive: true, force: true });
    },
  };

  if (!seeded && files.length) {
    await seed(backend, logsDir, files, logDir);
    fs.writeFileSync(marker, JSON.stringify({ key, files }));
  } else if (seeded) {
    log(`reusing seeded data in ${root}`);
  }
  return backend;
};

const seed = async (backend, logsDir, files, logDir) => {
  const { handle } = backend.desk;
  for (const f of files) {
    const t0 = Date.now();
    const name = `WoWCombatLog-${f.name.replace(/\.log\.gz$/, '')}.txt`;
    // Temp copy under the wow log dir; deleted after (never in the repo).
    await pipeline(
      fs.createReadStream(path.join(logsDir, f.name)),
      zlib.createGunzip(),
      fs.createWriteStream(path.join(logDir, name)),
    );
    const scan = await handle({ action: 'scanLog', file: name });
    if (!scan.ok) throw new Error(`scanLog ${name}: ${scan.error}`);
    const bosses = scan.data.map((b) => `${b.encounterId}:${b.difficultyId}`);
    const start = await handle({ action: 'backfillLog', file: name, bosses, hints: [] });
    if (!start.ok) throw new Error(`backfillLog ${name}: ${start.error}`);
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      const s = (await handle({ action: 'backfillStatus' })).data;
      if (!s.running) {
        log(
          `${f.name}: found ${s.found}, uploaded ${s.uploaded}, there ${s.alreadyThere}, skipped ${s.skipped}, failed ${s.failed}${s.error ? ` (${s.error})` : ''} in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
        );
        break;
      }
    }
    await fsp.rm(path.join(logDir, name), { force: true });
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > -1 ? process.argv[i + 1] : d;
  };
  const b = await startBackend({
    out: arg('out', '/tmp/rf-harness-out'),
    logsDir: arg('logs'),
    keep: arg('keep'),
    port: arg('port') ? Number(arg('port')) : undefined,
    reseed: process.argv.includes('--reseed'),
  });
  console.log(`guild server on ${b.base} (storage ${b.storage}); Ctrl+C to stop`);
}
