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
    if (u.includes('/talent-tree/index')) {
      return ok({
        spec_talent_trees: [
          { key: { href: 'https://api.example/data/wow/talent-tree/786/playable-specialization/262?namespace=static-us' } },
          { key: { href: 'https://api.example/data/wow/talent-tree/786/playable-specialization/264?namespace=static-us' } },
        ],
      });
    }
    if (u.includes('/talent-tree/786/playable-specialization/264')) {
      return ok({
        playable_class: { name: 'Shaman' },
        playable_specialization: { name: 'Restoration' },
        class_talent_nodes: [
          {
            id: 80978,
            display_row: 1,
            display_col: 2,
            raw_position_x: 1200,
            raw_position_y: 600,
            node_type: { type: 'PASSIVE' },
            unlocks: [80990],
            ranks: [
              { rank: 1, tooltip: { talent: { id: 101844 }, spell_tooltip: { spell: { id: 381650, name: 'Elemental Warding' }, description: 'Reduces all magic damage taken by 2%.' } } },
              { rank: 2, tooltip: { talent: { id: 101844 }, spell_tooltip: { spell: { id: 381650, name: 'Elemental Warding' }, description: 'Reduces all magic damage taken by 4%.' } } },
            ],
          },
          {
            id: 80990,
            ranks: [
              {
                rank: 1,
                choice_of_tooltips: [
                  { talent: { id: 101861 }, spell_tooltip: { spell: { id: 1, name: 'Choice A' }, description: 'A.' } },
                  { talent: { id: 101862 }, spell_tooltip: { spell: { id: 2, name: 'Choice B' }, description: 'B.' } },
                ],
              },
            ],
          },
        ],
        spec_talent_nodes: [],
        hero_talent_trees: [{ id: 54, name: 'Farseer', hero_talent_nodes: [{ id: 94000, display_row: 1, display_col: 1, ranks: [{ rank: 1, tooltip: { talent: { id: 117000 }, spell_tooltip: { spell: { id: 443442, name: 'Call of the Ancestors' } } } }] }] }],
      });
    }
    if (/spell\/404404/.test(u)) return { ok: false, status: 404, json: async () => ({}) };
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
  // A card for another ID the ability hits as (same name) shows it as on the
  // list, and turning it off there removes the journal's entry.
  const hitCard = await call('GET', ['journal', 'spell', '1250999'], undefined, '?encounterId=3500&name=Digestive%20Juices');
  assert.equal(hitCard.body.avoidable, true);
  const off = await call('PUT', ['bosses', '3500', 'avoidable-toggle'], { spellId: 1250999, name: 'Digestive Juices', on: false });
  assert.deepEqual(off.body.avoidable, []);

  const set = await call('PUT', ['bosses', '3500', 'journal'], { journalId: 'https://wowjournal.example/#encounter=2896' });
  assert.equal(set.body.journalId, 2896);
});

test('talent trees: node and entry IDs to spells, fetched once per spec', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  const { calls, fetchImpl } = fakeBlizzard();
  const journal = createJournal({ storage, env, fetchImpl });
  const tree = await journal.talents(264);
  assert.equal(tree.nodes[80978][1].options[0].text, 'Reduces all magic damage taken by 4%.');
  assert.deepEqual(
    tree.nodes[80990][0].options.map((o) => [o.entryId, o.name]),
    [
      [101861, 'Choice A'],
      [101862, 'Choice B'],
    ],
  );
  const node = tree.layout.class.find((n) => n.id === 80978);
  assert.deepEqual(
    { x: node.x, y: node.y, type: node.type, maxRank: node.maxRank, next: node.next },
    { x: 1200, y: 600, type: 'PASSIVE', maxRank: 2, next: [80990] },
  );
  assert.deepEqual(tree.layout.class.find((n) => n.id === 80990).entries.map((e) => e.entryId), [101861, 101862]);
  assert.equal(tree.layout.hero[0].name, 'Farseer');
  assert.equal(tree.layout.hero[0].nodes[0].entries[0].spellId, 443442);
  const before = calls.length;
  await journal.talents(264);
  assert.equal(calls.length, before);
  assert.deepEqual((await journal.talents(999)).nodes, {});
});

test('icons: local pack first, else downloaded once and cached; bad names refused', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  const pack = await fsp.mkdtemp(path.join(os.tmpdir(), 'pack-'));
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 4, 5, 6]);
  await fsp.writeFile(path.join(pack, 'spell_hd.png'), PNG);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('render.worldofwarcraft.com') && url.includes('spell_web')) {
      return new Response(JPG, { status: 200 });
    }
    return new Response('nope', { status: 404 });
  };
  const journal = createJournal({
    storage,
    env: { GUILD_CLOUD_ICON_DIR: pack, GUILD_CLOUD_ICON_PACK_URL: 'https://example.test/hd/{name}.png' },
    fetchImpl,
  });
  const hd = await journal.icon('SPELL_HD');
  assert.equal(hd.type, 'image/png');
  assert.deepEqual(hd.bytes, PNG);
  assert.equal(calls.length, 0);

  const web = await journal.icon('spell_web');
  assert.equal(web.type, 'image/jpeg');
  assert.deepEqual(calls, ['https://example.test/hd/spell_web.png', 'https://render.worldofwarcraft.com/us/icons/56/spell_web.jpg']);
  await journal.icon('spell_web');
  assert.equal(calls.length, 2, 'cached on disk');

  assert.equal(await journal.icon('nothing_here'), null);
  const n = calls.length;
  assert.equal(await journal.icon('nothing_here'), null);
  assert.equal(calls.length, n, 'misses remembered for a while');
  assert.equal(await journal.icon('../etc/passwd'), null);
});

test('spell icons: Warcraft Logs when Wowhead and Blizzard have none; no-icon answers retried', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  let wclCalls = 0;
  const wcl = {
    configured: true,
    query: async (text) => {
      wclCalls += 1;
      const id = Number(/ability\(id: (\d+)\)/.exec(text)[1]);
      return { gameData: { ability: { id, name: 'Eviscerate', icon: 'ability_rogue_eviscerate.jpg' } } };
    },
  };
  // Wowhead blocked (403), Blizzard not set up.
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const journal = createJournal({ storage, env: {}, fetchImpl, wcl });
  const got = await journal.spell(196819);
  assert.equal(got.icon, 'ability_rogue_eviscerate');
  assert.equal(got.name, 'Eviscerate');
  await journal.spell(196819);
  assert.equal(wclCalls, 1, 'cached');

  // An old cached answer without an icon is asked again.
  await fsp.mkdir(path.join(storage, 'journal'), { recursive: true });
  await fsp.writeFile(path.join(storage, 'journal', 'spells.json'), JSON.stringify({ '53:0': { id: 53, name: 'Backstab', text: 'Stab.', icon: null } }));
  const fresh = createJournal({ storage, env: {}, fetchImpl, wcl });
  const { spells } = await fresh.spells([53]);
  assert.equal(spells[53].icon, 'ability_rogue_eviscerate');
});

test('spell batches answer with what is cached without waiting on slow lookups', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  await fsp.mkdir(path.join(storage, 'journal'), { recursive: true });
  await fsp.writeFile(
    path.join(storage, 'journal', 'spells.json'),
    JSON.stringify({ '1:0': { id: 1, name: 'A', text: '', icon: 'a' } }),
  );
  let release;
  const slow = new Promise((r) => { release = r; });
  const fetchImpl = async (url) => {
    await slow;
    return { ok: true, status: 200, json: async () => ({ name: 'B', tooltip: '', icon: 'b' }) };
  };
  const journal = createJournal({ storage, env: {}, fetchImpl });
  const started = Date.now();
  const first = await journal.spells([1, 2], 0, 24, 50);
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(Object.keys(first.spells), ['1']);
  assert.equal(first.pending, 1);
  release();
  await new Promise((r) => setTimeout(r, 200));
  const second = await journal.spells([1, 2], 0, 24, 50);
  assert.equal(second.spells[2].icon, 'b');
  assert.equal(second.pending, 0);
});

test('Warcraft Logs names for spells, 30 to a query, kept', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  const queries = [];
  const wcl = {
    configured: true,
    query: async (text) => {
      queries.push(text);
      const out = {};
      for (const m of text.matchAll(/a(\d+): ability/g)) out[`a${m[1]}`] = { name: m[1] === '2' ? 'Eviscerate (Ancient Arts)' : 'Eviscerate' };
      return { gameData: out };
    },
  };
  const journal = createJournal({ storage, env: {}, fetchImpl: () => assert.fail('no fetch'), wcl });
  const ids = Array.from({ length: 35 }, (_, i) => i + 1);
  const { names } = await journal.names(ids);
  assert.equal(names[2], 'Eviscerate (Ancient Arts)');
  assert.equal(queries.length, 2);
  await journal.names([2, 3]);
  assert.equal(queries.length, 2, 'cached');
  const again = createJournal({ storage, env: {}, fetchImpl: () => assert.fail('no fetch'), wcl });
  assert.equal((await again.names([2])).names[2], 'Eviscerate (Ancient Arts)');
  assert.equal(queries.length, 2, 'kept on disk');
});

test('items: name, quality, slot and icon from Blizzard, kept', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-items-'));
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('oauth')) return ok({ access_token: 't', expires_in: 3600 });
    if (u.includes('/data/wow/media/item/271875'))
      return ok({ assets: [{ key: 'icon', value: 'https://render.example/icons/56/inv_helm_plate_raid.jpg' }] });
    if (u.includes('/data/wow/item/271875'))
      return ok({ name: 'Crown of Coils', quality: { type: 'EPIC' }, inventory_type: { type: 'HEAD' } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const journal = createJournal({ storage, env, fetchImpl });
  const got = await journal.items([271875, 5]);
  assert.deepEqual(got.items[271875], { name: 'Crown of Coils', quality: 'EPIC', slot: 'HEAD', icon: 'inv_helm_plate_raid' });
  assert.equal(got.items[5], undefined);
  const before = calls.length;
  await journal.items([271875, 5]);
  assert.equal(calls.length, before);
});

test('boss icons: Warcraft Logs boss icon first, else the journal creature portrait', async () => {
  const storage = await fsp.mkdtemp(path.join(os.tmpdir(), 'journal-'));
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 7, 8, 9]);
  const PORTRAIT = Buffer.from([0xff, 0xd8, 0xff, 1, 1, 1]);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes('rpglogs.example/3129')) return new Response(JPG, { status: 200 });
    if (u.includes('rpglogs.example')) return new Response('nope', { status: 404 });
    if (u.includes('oauth')) return ok({ access_token: 'tok', expires_in: 3600 });
    if (u.includes('/search/journal-encounter')) return ok({ results: [{ data: { id: 2896, name: { en_US: "Kith'ix" } } }] });
    if (u.includes('/journal-encounter/2896')) return ok({ ...KITHIX, creatures: [{ id: 1, creature_display: { id: 777 } }] });
    if (u.includes('/media/creature-display/777')) {
      assert.equal(init.headers.Authorization, 'Bearer tok');
      return ok({ assets: [{ key: 'zoom', value: 'https://render.example/creature-display-777-zoom.jpg' }] });
    }
    if (u.includes('creature-display-777-zoom')) return new Response(PORTRAIT, { status: 200 });
    return new Response('nope', { status: 404 });
  };
  const journal = createJournal({
    storage,
    env: {
      GUILD_CLOUD_BOSS_ICON_URL: 'https://rpglogs.example/{id}-icon.jpg',
      GUILD_CLOUD_BLIZZARD_CLIENT_ID: 'id',
      GUILD_CLOUD_BLIZZARD_CLIENT_SECRET: 'secret',
    },
    fetchImpl,
    bossName: async (id) => (id === 3300 ? "Kith'ix" : null),
  });

  const wclIcon = await journal.icon('wclboss-3129');
  assert.deepEqual(wclIcon.bytes, JPG);
  assert.deepEqual(calls, ['https://rpglogs.example/3129-icon.jpg']);

  const portrait = await journal.icon('wclboss-3300');
  assert.deepEqual(portrait.bytes, PORTRAIT);
  assert.ok(calls.some((u) => u.includes('creature-display-777-zoom')));
  const n = calls.length;
  await journal.icon('wclboss-3300');
  assert.equal(calls.length, n, 'cached on disk');

  // Unknown boss, no name: nothing, and not asked again right away.
  assert.equal(await journal.icon('wclboss-1'), null);
});
