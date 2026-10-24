import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { buildProgress, createWatcher } from './watcher.mjs';

const T0 = Date.parse('2026-09-15T00:30:00Z'); // 8:30 pm EDT
const fight = (encounterID, minutes, fightPercentage, kill = false) => ({
  encounterID,
  startTime: minutes * 60000,
  endTime: minutes * 60000 + 200000,
  kill,
  fightPercentage,
});

test('progress: pulls in order up to the first kill, duplicates merged', () => {
  const bosses = buildProgress(
    [
      {
        startTime: T0,
        fights: [fight(3429, 0, 80), fight(3429, 5, 55), fight(3492, 10, 90)],
      },
      // A second logger's copy of the same night (same pulls, few seconds off).
      { startTime: T0 + 3000, fights: [fight(3429, 5, 55)] },
      {
        startTime: T0 + 7 * 86400000,
        fights: [
          fight(3429, 0, 20),
          fight(3429, 6, 0, true),
          fight(3429, 12, 0, true),
        ],
      },
    ],
    { 3429: 'The Coiled Altar', 3492: "Ula'tek" },
  );
  const altar = bosses[3429];
  assert.deepEqual(
    altar.series.map((s) => s.percent),
    [80, 55, 20, 0],
  );
  assert.equal(altar.pulls, 4);
  assert.equal(altar.kill.pull, 4);
  assert.equal(altar.nights, 2);
  assert.equal(altar.series[0].night, '2026-09-14'); // after-midnight UTC counts as the night before
  assert.equal(bosses[3492].best, 90);
  assert.equal(bosses[3492].kill, null);
});

test('crawl: resolves the zone and guild, saves results; officers only', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'watcher-'));
  const respond = (data) => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        ...data,
        rateLimitData: {
          limitPerHour: 18000,
          pointsSpentThisHour: 10,
          pointsResetIn: 3000,
        },
      },
    }),
  });
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/oauth/token'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 't', expires_in: 3600 }),
      };
    const { query } = JSON.parse(init.body);
    if (query.includes('worldData'))
      return respond({
        worldData: {
          zones: [
            {
              id: 53,
              name: 'The Venomous Abyss',
              encounters: [{ id: 3429, name: 'The Coiled Altar' }],
            },
          ],
        },
      });
    if (query.includes('guildData'))
      return respond({ guildData: { guild: { id: 77, name: 'Top Guild' } } });
    if (query.includes('reports('))
      return respond({
        reportData: {
          reports: {
            has_more_pages: false,
            data: [{ code: 'abc', startTime: T0, endTime: T0 + 3600000 }],
          },
        },
      });
    return respond({
      reportData: {
        report: {
          startTime: T0,
          fights: [fight(3429, 0, 64.2), fight(3429, 5, 0, true)],
        },
      },
    });
  };
  const roles = { 1: ['officer'], 2: ['raider'] };
  const watcher = createWatcher({
    storage,
    readBody: async (req) => req.body,
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) =>
      Object.assign(res, { status, body: { error } }),
    memberRoleNames: async (id) => roles[id],
    env: {
      GUILD_CLOUD_WCL_CLIENT_ID: 'id',
      GUILD_CLOUD_WCL_CLIENT_SECRET: 'secret',
    },
    fetchImpl,
  });
  const call = async (who, method, rest, body) => {
    const res = {};
    await watcher.handle({ method, body, cloudUserId: who }, res, rest);
    return res;
  };

  assert.equal(
    (await call('2', 'PUT', ['settings'], { guilds: [] })).status,
    403,
  );
  assert.equal(
    (
      await call('1', 'PUT', ['settings'], {
        guilds: [1, 2, 3, 4].map(() => ({ name: 'a', realm: 'b' })),
      })
    ).status,
    400,
  );
  const saved = await call('1', 'PUT', ['settings'], {
    guilds: [{ name: 'Top Guild', realm: 'Area 52', region: 'US' }],
  });
  assert.equal(saved.body.frozen, true);
  assert.equal(saved.body.guilds[0].region, 'us');

  await watcher.crawl();
  const state = await call('2', 'GET', []);
  assert.equal(state.body.status.error, '', state.body.status.log.join('\n'));
  const boss = state.body.results.guilds[0].bosses[3429];
  assert.deepEqual(
    boss.series.map((s) => s.percent),
    [64.2, 0],
  );
  assert.equal(boss.kill.pull, 2);
  assert.equal(state.body.officer, false);
});
