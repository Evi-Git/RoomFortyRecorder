import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { cleanText, createJournal, journalAbilities, journalFromApi, mergeVariants, tooltipText } from './journal.mjs';
import { createPullDesk } from './pulldesk.mjs';

// The shape Blizzard's journal-encounter endpoint returns (trimmed).
const KITHIX = {
  id: 2896,
  name: "Kith'ix",
  description: 'A |cFFFFFFFFvoid|r horror.',
  instance: { id: 1400, name: "The Unbinding of Kith'ix" },
  modes: [{ type: 'NORMAL' }, { type: 'HEROIC' }, { type: 'MYTHIC' }],
  sections: [
    {
      id: 1,
      title: 'Stage One: Hunger',
      body_text: 'Kith\'ix feeds.',
      sections: [
        { id: 2, title: 'Digestive Juices', body_text: '$bullet;Coats the raid in acid.', spell: { id: 1250001, name: 'Digestive Juices' } },
        { id: 3, title: 'Dark Frenzy', body_text: 'Enrages.', spell: { id: 1250002, name: 'Dark Frenzy' }, icon_flags: [12, 11] },
      ],
    },
  ],
};

const fakeBlizzard = () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('wowhead.example')) {
      const id = Number(/spell\/(\d+)/.exec(u)[1]);
      if (id === 404404) return { ok: false, status: 404, json: async () => ({}) };
      const dd = /dd=(\d+)/.exec(u)?.[1] || 'none';
      return ok({
        name: `Spell ${id}`,
        icon: 'Ability_Creature_Poison_02',
        tooltip: `<table><tr><td><b>Spell ${id}</b></td></tr></table><div class="q">Inflicts 1250110 damage (dd ${dd}).<br>Knocks back.</div>`,
      });
    }
    if (u.includes('oauth')) {
      assert.match(init.headers.Authorization, /^Basic /);
      return ok({ access_token: 'tok', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, 'Bearer tok');
    assert.match(u, /namespace=static-us/);
    if (u.includes('/search/journal-encounter')) {
      return ok({ results: [{ data: { id: 1999, name: { en_US: "Kith'ix (old)" } } }, { data: { id: 2896, name: { en_US: "Kith'ix" } } }] });
    }
    if (u.includes('/journal-encounter/2896')) return ok(KITHIX);
    if (u.includes('/media/spell/')) {
      const id = /spell\/(\d+)/.exec(u)[1];
      return ok({ assets: [{ key: 'icon', value: `https://render.example/icons/56/${id}.jpg` }] });
    }
    if (u.includes('/spell/')) {
      const id = /spell\/(\d+)/.exec(u)[1];
      return ok({ id: Number(id), name: `Spell ${id}`, description: `Does a thing (${id}).` });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetchImpl };
};

const env = {
  GUILD_CLOUD_WOWHEAD_TOOLTIP: 'https://wowhead.example/tooltip/spell',
  GUILD_CLOUD_BLIZZARD_CLIENT_ID: 'id',
  GUILD_CLOUD_BLIZZARD_CLIENT_SECRET: 'secret',
  GUILD_CLOUD_BLIZZARD_OAUTH: 'https://oauth.example/token',
  GUILD_CLOUD_BLIZZARD_API: 'https://api.example',
};

test('tooltip text and merged difficulty versions', () => {
  assert.equal(
    tooltipText('<table><tr><td>Venom Roar</td><td>3 sec cast</td></tr></table><div class="q">Inflicts 1250110 Nature &amp; Physical.<br>Knocks back.</div>'),
    'Inflicts 1,250,110 Nature & Physical.\nKnocks back.',
  );
  const node = (id, title, text, spellId, children = []) => ({ id, title, text, spellId, tags: [], depth: 1, children });
  const merged = mergeVariants([
    node(1, 'Damage Dealers', '• Kill adds.', null),
    node(2, 'Damage Dealers', '• Kill adds.\n• Soak orbs.', null),
    node(3, 'Venomous Hulk', '', null, [node(4, 'Venom Roar', '', 1302884)]),
    node(5, 'Venomous Hulk', '', null, [node(6, 'Venom Roar', '', 1302884), node(7, 'Incubation', '', 1307407)]),
  ]);
  assert.deepEqual(merged.map((m) => m.title), ['Damage Dealers', 'Venomous Hulk']);
  assert.equal(merged[0].text, '• Kill adds.\n• Soak orbs.');
  assert.deepEqual(merged[1].children.map((c) => c.title), ['Venom Roar', 'Incubation']);
});

test('journal text and structure', () => {
  assert.equal(cleanText('|cFFFF0000Red|r and $bullet;one'), 'Red and • one');
  const j = journalFromApi(KITHIX);
  assert.equal(j.journalId, 2896);
  assert.equal(j.description, 'A void horror.');
  assert.deepEqual(j.modes, ['NORMAL', 'HEROIC', 'MYTHIC']);
  const abilities = journalAbilities(j);
  assert.deepEqual(abilities.map((a) => a.title), ['Stage One: Hunger', 'Digestive Juices', 'Dark Frenzy']);
  assert.equal(abilities[1].text, '• Coats the raid in acid.');
  assert.equal(abilities[1].depth, 1);
  assert.deepEqual(abilities[2].tags, ['mythic', 'enrage']);
  assert.equal(j.spells[1250001].title, 'Digestive Juices');
});

test('finds a boss by name, caches it; spell text per difficulty from Wowhead, once', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  const { calls, fetchImpl } = fakeBlizzard();
  const journal = createJournal({ storage, env, fetchImpl });
  assert.equal(journal.configured, true);

  const j = await journal.encounter({ name: "Kith'ix" });
  assert.equal(j.journalId, 2896); // exact name match, not the "(old)" one
  const before = calls.length;
  await journal.encounter({ name: "Kith'ix" });
  assert.equal(calls.length, before); // from the cache

  const mythic = await journal.spell(1250001, 233);
  assert.equal(mythic.icon, 'ability_creature_poison_02');
  assert.equal(mythic.text, 'Inflicts 1,250,110 damage (dd 233).\nKnocks back.');
  const heroic = await journal.spell(1250001, 15);
  assert.match(heroic.text, /dd 15/);
  assert.equal(await journal.spell(404404, 233), null);

  // Batches fill in over a few calls.
  const first = await journal.spells([1250001, 1250002, 1250003, 'x'], 233, 1);
  assert.deepEqual(Object.keys(first.spells).sort(), ['1250001', '1250002']);
  assert.equal(first.pending, 1);
  const second = await journal.spells([1250001, 1250002, 1250003], 233, 5);
  assert.equal(second.pending, 0);
  const n = calls.length;
  await journal.spells([1250001, 1250002, 1250003], 233);
  await journal.spell(404404, 233);
  assert.equal(calls.length, n); // all cached, misses too
  assert.equal((await journal.raw(2896)).name, "Kith'ix");
});

test('not configured: no requests, a clear flag', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  const journal = createJournal({ storage, env: {}, fetchImpl: () => assert.fail('no requests') });
  assert.equal(journal.configured, false);
});

test('pull desk journal routes: boss view, ability card, avoidable toggle, journal ID', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'pd-journal-'));
  const { fetchImpl } = fakeBlizzard();
  const journal = createJournal({ storage, env, fetchImpl });
  const desk = createPullDesk({
    storage,
    readBody: async (req) => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    fail: (res, status, error) => Object.assign(res, { status, body: { error } }),
    memberRoleNames: async () => ['officer'],
    botToken: '',
    env: {},
    journal,
    wcl: { configured: false },
  });
  await desk.ready();
  const call = async (method, rest, body, query = '') => {
    const res = {};
    await desk.handle({ method, body, cloudUserId: '1', cloudUserName: 'Evi' }, res, rest, new URL(`http://x/${query}`));
    return res;
  };

  // A Kith'ix pull the app saw (a claim), so the server knows the boss.
  await call('POST', ['claim'], { encounterId: 3500, difficultyId: 233, duration: 61, encounterName: "Kith'ix", startedAt: Date.now() - 1e6 });

  const boss = await call('GET', ['journal', 'boss', '3500'], undefined, '?difficulty=233');
  assert.equal(boss.status, 200, JSON.stringify(boss.body));
  assert.equal(boss.body.journal.journalId, 2896);
  assert.equal(boss.body.configured, true);

  const card = await call('GET', ['journal', 'spell', '1250001'], undefined, '?encounterId=3500&difficulty=233&name=Digestive%20Juices');
  assert.equal(card.body.source, 'tooltip');
  assert.equal(card.body.text, 'Inflicts 1,250,110 damage (dd 233).\nKnocks back.');
  assert.equal(card.body.icon, 'ability_creature_poison_02');
  assert.equal(card.body.name, 'Digestive Juices'); // the journal's name
  assert.equal(card.body.avoidable, false);
  // A spell the journal doesn't list still gets its tooltip.
  const other = await call('GET', ['journal', 'spell', '999'], undefined, '?encounterId=3500');
  assert.equal(other.body.source, 'tooltip');
  assert.equal(other.body.name, 'Spell 999');
  const batch = await call('POST', ['journal', 'spells'], { ids: [999, 1250001], difficulty: 233 });
  assert.deepEqual(Object.keys(batch.body.spells).sort(), ['1250001', '999']);

  const on = await call('PUT', ['bosses', '3500', 'avoidable-toggle'], { spellId: 1250001, name: 'Digestive Juices', on: true });
  assert.deepEqual(on.body.avoidable, [{ id: 1250001, name: 'Digestive Juices' }]);
  assert.equal((await call('GET', ['journal', 'spell', '1250001'], undefined, '?encounterId=3500')).body.avoidable, true);
  const off = await call('PUT', ['bosses', '3500', 'avoidable-toggle'], { spellId: 1250001, on: false });
  assert.deepEqual(off.body.avoidable, []);

  const set = await call('PUT', ['bosses', '3500', 'journal'], { journalId: 'https://wowjournal.example/#encounter=2896' });
  assert.equal(set.body.journalId, 2896);
});
