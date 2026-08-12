import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(SERVER_DIR, 'server.mjs');
const GUILD = 'Room Forty';
const SECRET = 'focused-guild-cloud-test-secret';
const FULL_VIDEO = {
  videoKey: 'cloud-full-video-key.mp4',
  videoName: 'Raid Night & Mythic+ 2026-08-11.mp4',
  category: 'Raids',
};
const CLIP = {
  videoKey: 'cloud-clip-key.mp4',
  videoName: 'Boss pull #3 clip.mp4',
  category: 'Clips',
};
const FULL_VIDEO_BYTES = Buffer.from('room-forty-full-video-bytes');
const CLIP_BYTES = Buffer.from('room-forty-clip-bytes');

let storage;
let port;
let baseUrl;
let server;
let serverOutput = '';
let fullLinkId;
let clipLinkId;

const reservePort = () =>
  new Promise((resolve, reject) => {
    const socket = http.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });

const sessionToken = () => {
  const payload = {
    action: 'session',
    guild: GUILD,
    discordId: 'focused-test-user',
    userName: 'Focused test user',
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
};

const waitForHealth = async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Guild cloud server exited early:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The server may not be listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Guild cloud server did not start:\n${serverOutput}`);
};

const startServer = async () => {
  serverOutput = '';
  server = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      GUILD_CLOUD_DISCORD_ALLOWED_ROLES: 'raider',
      GUILD_CLOUD_DISCORD_BOT_TOKEN: 'focused-test-bot-token',
      GUILD_CLOUD_DISCORD_CLIENT_ID: 'focused-test-client-id',
      GUILD_CLOUD_DISCORD_CLIENT_SECRET: 'focused-test-client-secret',
      GUILD_CLOUD_DISCORD_GUILD_ID: 'focused-test-guild-id',
      GUILD_CLOUD_DISCORD_REDIRECT_URI: `${baseUrl}/auth/discord/callback`,
      GUILD_CLOUD_GUILD: GUILD,
      GUILD_CLOUD_HOST: '127.0.0.1',
      GUILD_CLOUD_PORT: String(port),
      GUILD_CLOUD_PUBLIC_URL: baseUrl,
      GUILD_CLOUD_SECRET: SECRET,
      GUILD_CLOUD_STORAGE_PATH: storage,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk;
  });
  await waitForHealth();
};

const stopServer = async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await exited;
};

const createLink = async (videoName) => {
  const response = await fetch(
    `${baseUrl}/api/guild/${encodeURIComponent(GUILD)}/video/${encodeURIComponent(videoName)}/link`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken()}` },
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.id, /^[A-Za-z0-9_-]+$/);
  return body.id;
};

const readState = async () =>
  JSON.parse(await fsp.readFile(path.join(storage, 'state.json'), 'utf8'));

before(async () => {
  storage = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'room-forty-guild-cloud-test-'),
  );
  await fsp.mkdir(path.join(storage, 'videos'));
  await Promise.all([
    fsp.writeFile(
      path.join(storage, 'videos', FULL_VIDEO.videoKey),
      FULL_VIDEO_BYTES,
    ),
    fsp.writeFile(path.join(storage, 'videos', CLIP.videoKey), CLIP_BYTES),
  ]);
  await fsp.writeFile(
    path.join(storage, 'state.json'),
    JSON.stringify({
      videos: [FULL_VIDEO, CLIP],
      chats: [],
      links: [],
      nextMessageId: 1,
    }),
  );

  port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  await startServer();
});

after(async () => {
  await stopServer();
  await fsp.rm(storage, { recursive: true, force: true });
});

test('creates a stable public link from an uploaded video name', async () => {
  fullLinkId = await createLink(FULL_VIDEO.videoName);

  const state = await readState();
  assert.deepEqual(
    state.links.find((link) => link.id === fullLinkId),
    {
      id: fullLinkId,
      guild: GUILD,
      key: FULL_VIDEO.videoKey,
      likes: 0,
    },
  );

  const page = await fetch(`${baseUrl}/link/${fullLinkId}`);
  const html = await page.text();
  assert.equal(page.status, 200, `${html}\n${serverOutput}`);
  assert.match(html, /Raid Night &amp; Mythic\+ 2026-08-11\.mp4/);
  assert.match(html, new RegExp(`/link/${fullLinkId}/video`));
  assert.match(html, /id="like"/);

  const stream = await fetch(`${baseUrl}/link/${fullLinkId}/video`, {
    headers: { Range: 'bytes=2-8' },
  });
  assert.equal(stream.status, 206);
  assert.equal(
    stream.headers.get('content-range'),
    `bytes 2-8/${FULL_VIDEO_BYTES.length}`,
  );
  assert.deepEqual(
    Buffer.from(await stream.arrayBuffer()),
    FULL_VIDEO_BYTES.subarray(2, 9),
  );
});

test('persists full-video likes across a server restart', async () => {
  const response = await fetch(`${baseUrl}/link/${fullLinkId}/like`, {
    method: 'POST',
  });
  const responseBody = await response.json();
  assert.equal(
    response.status,
    200,
    `${JSON.stringify(responseBody)}\n${serverOutput}`,
  );
  assert.deepEqual(responseBody, { likes: 1 });

  let state = await readState();
  assert.equal(state.links.find((link) => link.id === fullLinkId).likes, 1);

  await stopServer();
  await startServer();

  const page = await fetch(`${baseUrl}/link/${fullLinkId}`);
  const html = await page.text();
  assert.match(html, /<span id="likes">1<\/span>/);

  state = await readState();
  assert.equal(state.links.find((link) => link.id === fullLinkId).likes, 1);
});

test('creates and streams a stable public clip link', async () => {
  clipLinkId = await createLink(CLIP.videoName);

  const state = await readState();
  assert.equal(
    state.links.find((link) => link.id === clipLinkId).key,
    CLIP.videoKey,
  );

  const page = await fetch(`${baseUrl}/link/${clipLinkId}`);
  const html = await page.text();
  assert.equal(page.status, 200, `${html}\n${serverOutput}`);
  assert.match(html, /Boss pull #3 clip\.mp4/);
  assert.match(html, new RegExp(`/link/${clipLinkId}/video`));
  assert.doesNotMatch(html, /id="like"/);

  const stream = await fetch(`${baseUrl}/link/${clipLinkId}/video`, {
    headers: { Range: 'bytes=-4' },
  });
  assert.equal(stream.status, 206);
  assert.deepEqual(
    Buffer.from(await stream.arrayBuffer()),
    CLIP_BYTES.subarray(CLIP_BYTES.length - 4),
  );

  const like = await fetch(`${baseUrl}/link/${clipLinkId}/like`, {
    method: 'POST',
  });
  assert.equal(like.status, 403);
  assert.deepEqual(await like.json(), {
    error: 'Likes are disabled for clips',
  });
});
