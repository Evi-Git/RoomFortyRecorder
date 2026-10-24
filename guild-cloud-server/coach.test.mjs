import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createCoach } from './coach.mjs';

// A fake Discord: channel list, member list and a message endpoint.
const startDiscord = async () => {
  const posted = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url.endsWith('/channels') && req.method === 'GET') {
      return send(200, [
        { id: '900', type: 4, name: 'Coaching', position: 2 },
        { id: '111111', type: 0, name: 'evi-coaching', parent_id: '900', position: 1 },
        { id: '222222', type: 0, name: 'mage-b', parent_id: '900', position: 2 },
        { id: '333333', type: 2, name: 'Voice' },
      ]);
    }
    if (req.url.includes('/members')) return send(403, { message: 'Missing intent' });
    const match = /\/channels\/(\d+)\/messages/.exec(req.url);
    if (match && req.method === 'POST') {
      if (match[1] === '444444') return send(403, { message: 'Missing access' });
      posted.push({ channel: match[1], ...JSON.parse(Buffer.concat(chunks).toString()) });
      return send(200, { id: '1' });
    }
    return send(404, {});
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, posted, url: `http://127.0.0.1:${server.address().port}` };
};

const setup = async () => {
  const discord = await startDiscord();
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'coach-'));
  const ids = { officer1: '100001', raider1: '200001', raider2: '200002' };
  const roles = { 100001: ['officer'], 200001: ['raider'], 200002: ['raider'] };
  const coach = createCoach({
    storage,
    // Like the server's readBody: refuse bodies over the limit.
    readBody: async (req, max) => {
      if (max && JSON.stringify(req.body || {}).length > max) throw new Error('Request body too large');
      return req.body || {};
    },
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async (id) => roles[id] || [],
    botToken: 'x',
    discordGuildId: '1',
    publicUrl: 'https://example.test',
    createShareLink: async (name) => (name === 'missing' ? null : { id: `link-${name}` }),
    env: { GUILD_CLOUD_COACH_DISCORD_API: discord.url },
  });
  const call = async (who, method, rest, body, query = '') => {
    const res = {};
    await coach.handle(
      { method, body, cloudUserId: ids[who], cloudUserName: who.replace(/\d/, '') },
      res,
      rest,
      new URL(`http://x/${query}`),
    );
    return res;
  };
  return { discord, call, coach };
};

test('officers send anywhere; raiders only to their mapped channel', async (t) => {
  const { discord, call, coach } = await setup();
  t.after(() => discord.server.close());

  const officer = await call('officer1', 'GET', ['config']);
  assert.equal(officer.body.officer, true);
  assert.deepEqual(officer.body.channels.map((c) => c.name), ['evi-coaching', 'mage-b']);
  assert.equal(officer.body.channels[0].category, 'Coaching');
  // No member intent: falls back to people who used the app.
  assert.ok(officer.body.members.some((m) => m.discordId === '100001'));

  assert.equal((await call('raider1', 'PUT', ['mapping'], { mapping: [] })).status, 403);
  const saved = await call('officer1', 'PUT', ['mapping'], {
    mapping: [
      { discordId: '555555', name: 'Mage A', channelId: '111111' },
      { discordId: 'bad', name: 'x', channelId: '1' },
    ],
  });
  assert.equal(saved.body.count, 1);

  // Mage B's channel gets Mage A's clip, from an officer.
  const sent = await call('officer1', 'POST', ['send'], {
    videoName: 'mage-a-pull-7',
    channelId: '222222',
    note: 'Watch the orb soak here',
    at: 151,
    title: 'Coiled Altar pull 7',
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.url, 'https://example.test/link/link-mage-a-pull-7?t=151');
  assert.equal(discord.posted[0].channel, '222222');
  assert.match(discord.posted[0].content, /watch from 2:31/);
  assert.match(discord.posted[0].content, /> Watch the orb soak here/);
  assert.deepEqual(discord.posted[0].allowed_mentions, { parse: [] });

  // A clip sent with its preview frame: the link page gets an og:image.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  const withThumb = await call('officer1', 'POST', ['send'], { videoName: 'clip-1', channelId: '222222', thumbnail: jpeg });
  assert.equal(withThumb.status, 200);
  assert.ok(await coach.thumbnailPath('link-clip-1'));
  assert.equal(await coach.thumbnailPath('link-mage-a-pull-7'), null);
  // A full-size preview frame fits (a real game frame is ~100-300 KB).
  const big = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300 * 1024, 7)]).toString('base64');
  assert.equal((await call('officer1', 'POST', ['send'], { videoName: 'clip-big', channelId: '222222', thumbnail: big })).status, 200);
  assert.ok(await coach.thumbnailPath('link-clip-big'));

  // Anything that isn't a JPEG is ignored.
  await call('officer1', 'POST', ['send'], { videoName: 'clip-2', channelId: '222222', thumbnail: Buffer.from('<svg>').toString('base64') });
  assert.equal(await coach.thumbnailPath('link-clip-2'), null);

  // A raider without a mapping can't send anywhere.
  assert.equal((await call('raider1', 'POST', ['send'], { videoName: 'v', channelId: '222222' })).status, 403);

  // Map the raider and they can send to theirs only.
  await call('officer1', 'PUT', ['mapping'], { mapping: [{ discordId: '200001', name: 'Raider', channelId: '111111' }] });
  const raiderConfig = await call('raider1', 'GET', ['config']);
  assert.equal(raiderConfig.body.officer, false);
  assert.deepEqual(raiderConfig.body.channels.map((c) => c.id), ['111111']);
  assert.deepEqual(raiderConfig.body.members, []);
  assert.equal((await call('raider1', 'POST', ['send'], { videoName: 'v', channelId: '111111' })).status, 200);
  assert.equal((await call('raider1', 'POST', ['send'], { videoName: 'v', channelId: '222222' })).status, 403);

  // Not uploaded, or the bot can't post there.
  assert.equal((await call('officer1', 'POST', ['send'], { videoName: 'missing', channelId: '222222' })).status, 404);
  const denied = await call('officer1', 'POST', ['send'], { videoName: 'v', channelId: '444444' });
  assert.equal(denied.status, 502);
  assert.match(denied.body.error, /cannot post/);
});

test('flags: create, list, edit own, officers can delete any', async (t) => {
  const { discord, call } = await setup();
  t.after(() => discord.server.close());

  const now = Date.now();
  const flag = await call('raider1', 'POST', ['flags'], { streamer: 'Shadeaux', at: now - 2000, note: '' });
  assert.equal(flag.status, 200);
  assert.equal(flag.body.by, 'raider');
  assert.equal((await call('raider1', 'POST', ['flags'], { at: now - 7 * 3600000 })).status, 400);

  const listed = await call('raider2', 'GET', ['flags'], undefined, '?days=1');
  assert.equal(listed.body.flags.length, 1);

  assert.equal((await call('raider2', 'PATCH', ['flags', flag.body.id], { note: 'x' })).status, 403);
  const edited = await call('raider1', 'PATCH', ['flags', flag.body.id], { note: 'Late kick' });
  assert.equal(edited.body.note, 'Late kick');
  assert.equal((await call('officer1', 'DELETE', ['flags', flag.body.id])).status, 200);
  assert.equal((await call('raider1', 'GET', ['flags'])).body.flags.length, 0);
});
