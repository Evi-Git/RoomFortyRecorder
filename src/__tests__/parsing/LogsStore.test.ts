import fs from 'fs';
import path from 'path';
import { F, K, lineSeconds, StoreBuilder } from '../../renderer/logs/store';
import {
  DEFAULT_FILTERS,
  makeCtx,
  meterRows,
  viewSeconds,
} from '../../renderer/logs/query';
import { compileExpression } from '../../renderer/logs/expression';

/** [RoomFortyRecorder] The Logs page's event store and queries on a real pull. */

const lines = fs
  .readFileSync(
    path.join(__dirname, '../../../tests/logs/retail/beloren_boss_hp.txt'),
    'utf8',
  )
  .split('\n');

const build = (transform: (l: string) => string = (l) => l) => {
  const b = new StoreBuilder();
  lines.forEach((l) => b.feed(transform(l)));
  return b.finish({
    id: 'x',
    label: 'Pull 1',
    encounterId: 3182,
    difficultyId: 16,
    startedAt: 0,
    result: 'wipe',
  });
};

test('reads timestamps with and without a time zone', () => {
  expect(lineSeconds('4/30/2026 20:05:17.7771  X')).toBeCloseTo(
    lineSeconds('4/30/2026 20:05:17.7771-4  X'),
  );
  expect(Number.isFinite(lineSeconds('4/30/2026 20:05:17.7771+10  X'))).toBe(
    true,
  );
});

test('times, deaths cut-off and slices work with time zone stamps', () => {
  const p = build((l) => l.replace(/^(\S+ [\d:.]+) {2}/, '$1-4  '));
  expect(p.t.every((t) => Number.isFinite(t))).toBe(true);
  expect(p.deaths.length).toBeGreaterThan(2);
  const total = (f: Partial<typeof DEFAULT_FILTERS>) =>
    meterRows(makeCtx([p], { ...DEFAULT_FILTERS, ...f }), 'damage').reduce(
      (n, r) => n + r.total,
      0,
    );
  const all = total({});
  expect(total({ deathCutoff: 1 })).toBeLessThan(all);
  expect(total({ range: [30, 60] })).toBeLessThan(all / 3);
  expect(
    viewSeconds(makeCtx([p], { ...DEFAULT_FILTERS, deathCutoff: 1 })),
  ).toBeCloseTo(p.deaths[0].t, 1);
});

test('filter expressions', () => {
  const p = build();
  const count = (src: string) => {
    const fn = compileExpression(src)!;
    let n = 0;
    for (let i = 0; i < p.n; i += 1) if (fn(p, i)) n += 1;
    return n;
  };
  expect(count('type = death')).toBeGreaterThan(0);
  expect(count('type = damage and target.type = player')).toBeGreaterThan(
    count('type = damage and target.type = player and amount > 100k'),
  );
  expect(() => compileExpression('bogus = 1')).toThrow(/Unknown field/);
});

test('active time never passes the fight, enemy filters and multi-ability filter', () => {
  const p = build();
  const ctx = makeCtx([p], DEFAULT_FILTERS);
  const rows = meterRows(ctx, 'damage');
  rows.forEach((r) =>
    expect(r.active).toBeLessThanOrEqual(viewSeconds(ctx) + 0.001),
  );
  const total = (f: Partial<typeof DEFAULT_FILTERS>) =>
    meterRows(makeCtx([p], { ...DEFAULT_FILTERS, ...f }), 'damage').reduce(
      (n, r) => n + r.total,
      0,
    );
  const all = total({});
  const bosses = total({ enemy: { kind: 'bosses' } });
  const adds = total({ enemy: { kind: 'adds' } });
  expect(bosses).toBeGreaterThan(0);
  expect(Math.round(bosses + adds)).toBe(Math.round(all));
  const [a, b] = [...rows[0].abilities.values()].map((x) => x.spellId);
  const one = total({ abilities: [a] });
  expect(total({ abilities: [a, b] })).toBeGreaterThan(one);
});

test('passive reduction talents read from their descriptions', () => {
  const {
    parseReduction,
    talentSpells,
  } = require('../../renderer/logs/talents');
  expect(parseReduction('Reduces all magic damage taken by 4%.')).toEqual({
    r: 0.04,
    schools: 126,
  });
  expect(
    parseReduction(
      'Damage taken from Fire, Frost, and Nature effects reduced by 3%.',
    ),
  ).toEqual({
    r: 0.03,
    schools: 4 | 8 | 16,
  });
  expect(parseReduction('Reduces damage taken by 40% for 12 sec.')).toBeNull();
  expect(parseReduction('Increases your Haste by 5%.')).toBeNull();
  const tree = {
    specId: 264,
    nodes: {
      1: [
        {
          rank: 1,
          options: [
            {
              entryId: 11,
              spellId: 100,
              name: 'Warding',
              text: 'Reduces all magic damage taken by 2%.',
            },
          ],
        },
        {
          rank: 2,
          options: [
            {
              entryId: 11,
              spellId: 100,
              name: 'Warding',
              text: 'Reduces all magic damage taken by 4%.',
            },
          ],
        },
      ],
      2: [
        {
          rank: 1,
          options: [
            { entryId: 21, spellId: 200, name: 'A', text: '' },
            { entryId: 22, spellId: 201, name: 'B', text: '' },
          ],
        },
      ],
    },
  };
  const picked = talentSpells(
    [
      [1, 11, 2],
      [2, 22, 1],
      [9, 99, 1],
    ],
    tree,
  );
  expect(
    picked.map((t: { name: string; text: string }) => `${t.name}:${t.text}`),
  ).toEqual(['Warding:Reduces all magic damage taken by 4%.', 'B:']);
});

test('buffs that cut damage taken count while up, credited to the caster', () => {
  const { parseReduction } = require('../../renderer/logs/talents');

  const { preventedRows } = require('../../renderer/logs/query');
  const er =
    'Healing from Healing Stream Totem reduces Fire, Frost, and Nature damage taken by 6% for 3 sec.';
  expect(parseReduction(er)).toBeNull();
  expect(parseReduction(er, true)).toEqual({ r: 0.06, schools: 4 | 8 | 16 });
  expect(
    parseReduction('Reduces damage taken by 2% for each enemy nearby.', true),
  ).toBeNull();

  const p = build();
  // A buff a raider put on another raider, standing in for one.
  const buff = p.auras.find(
    (a) =>
      !a.debuff &&
      a.src >= 0 &&
      a.dst >= 0 &&
      a.src !== a.dst &&
      p.units[a.dst].raider &&
      p.units[p.units[a.src].root].raider &&
      a.end - a.start > 5,
  );
  expect(buff).toBeTruthy();
  if (!buff) return;
  const spellId = p.spells[buff.spell].id;
  const ctx = makeCtx([p], DEFAULT_FILTERS);
  const without = preventedRows(ctx);
  const withBuff = preventedRows(ctx, {
    auras: new Map([[spellId, { r: 0.1, schools: 127, name: 'Test buff' }]]),
  });
  const sum = (rows: { total: number }[]) =>
    rows.reduce((n, r) => n + r.total, 0);
  expect(sum(withBuff)).toBeGreaterThan(sum(without));
  const caster = p.units[p.units[buff.src].root];
  const row = withBuff.find((r: { name: string }) =>
    caster.name.startsWith(r.name),
  );
  expect(
    [...row.abilities.values()].some(
      (a: { spellId: number }) => a.spellId === spellId,
    ),
  ).toBe(true);
});

test('abilities sharing a name are one group, the cast one first', () => {
  const { groupAbilities } = require('../../renderer/logs/query');
  const row = (spellId: number, name: string, total: number, casts = 0) => ({
    key: `${spellId}|`,
    spellId,
    name,
    by: '',
    total,
    hits: 1,
    crits: 0,
    ticks: 0,
    casts,
    misses: 0,
    overheal: 0,
    absorbed: 0,
    mitigated: 0,
    uptime: 0,
  });
  const groups = groupAbilities([
    row(2, 'Eviscerate', 900),
    row(1, 'Eviscerate', 700, 78),
    row(3, 'Backstab', 200, 71),
  ]);
  expect(groups).toHaveLength(2);
  const evis = groups.find(
    (g: { head: { name: string } }) => g.head.name === 'Eviscerate',
  );
  expect(evis.parts.map((a: { spellId: number }) => a.spellId)).toEqual([1, 2]);
  expect(evis.head.total).toBe(1600);
  expect(evis.head.casts).toBe(78);
});

test("Lightspire Core's beam isn't a cast (matched by name)", () => {
  const first = lines.findIndex(
    (l) =>
      l.includes('SPELL_CAST_SUCCESS,Player-') &&
      !l.includes('"Lightspire Core"'),
  );
  const fake = lines[first].replace(
    /^(.*?SPELL_CAST_SUCCESS,(?:[^,]*,){8})\d+,"[^"]*"/,
    '$11299999,"Lightspire Core"',
  );
  expect(fake).toContain('1299999,"Lightspire Core"');
  const b = new StoreBuilder();
  lines.slice(0, first + 1).forEach((l) => b.feed(l));
  b.feed(fake);
  const p = b.finish({
    id: 'x',
    label: 'Pull 1',
    encounterId: 3182,
    difficultyId: 16,
    startedAt: 0,
    result: 'wipe',
  });
  const i = p.k.lastIndexOf(K.CAST);
  expect(p.spells[p.sp[i]].name).toBe('Lightspire Core');
  expect(p.f[i] & F.PROC).toBe(F.PROC);
});

test('pets nest the way Warcraft Logs nests them (1.9.106)', () => {
  const { groupAbilities } = require('../../renderer/logs/query');
  const row = (
    spellId: number,
    name: string,
    by: string,
    summon?: { id: number; name: string },
  ) => ({
    key: `${spellId}|${by}${summon ? `@${summon.id}` : ''}`,
    spellId,
    name,
    by,
    summon,
    total: 100,
    hits: 1,
    crits: 0,
    ticks: 0,
    casts: 0,
    misses: 0,
    overheal: 0,
    absorbed: 0,
    mitigated: 0,
    uptime: 0,
  });
  const groups = groupAbilities([
    // Wild Imps from Hand of Gul'dan and from Inner Demons: two rows.
    row(104318, 'Fel Firebolt', 'Wild Imp', { id: 104317, name: 'Wild Imp' }),
    row(104318, 'Fel Firebolt', 'Wild Imp', { id: 279910, name: 'Wild Imp' }),
    // Blood Beast's The Blood is Life: under the Blood Beast.
    row(434246, 'The Blood is Life', 'Blood Beast', {
      id: 434237,
      name: 'The Blood is Life',
    }),
    // Mirror Image's Frostbolt (no summon seen): under Mirror Image.
    row(59638, 'Frostbolt', 'Mirror Image'),
  ]);
  const heads = groups.map((g: { head: { name: string }; nested: boolean }) => [
    g.head.name,
    g.nested,
  ]);
  expect(heads).toEqual([
    ['Wild Imp', true],
    ['Wild Imp', true],
    ['Blood Beast', true],
    ['Mirror Image', true],
  ]);
});

test('a pet only ever written as "Unknown" takes its name from any line', () => {
  const stamp = '10/21/2026 23:24:40.000-4  ';
  const owner = 'Player-61-0EDCA7E8,"Smoggw-Zul\'jin-US",0x514,0x80000000';
  const boss =
    'Creature-0-3882-3095-19964-267861-00005981DA,"Kith\'ix",0x10a48,0x80000000';
  const pet1 = 'Pet-0-3882-3095-19964-17252-0103ABCDEF';
  const pet2 = 'Pet-0-3882-3095-19964-17252-0103ABCDF0';
  const adv = (guid: string, ownerGuid: string) =>
    `${guid},${ownerGuid},821644,1061676,780,3657,2970,783,0,44147,0,220235,260000,0,1842.76,-22.54,2669,1.2127,334`;
  const hit = (src: string, name: string) =>
    `${stamp}SPELL_DAMAGE,${src},"${name}",0x1114,0x80000000,${boss},30213,"Legion Strike",0x1,${adv(src, 'Player-61-0EDCA7E8')},1000,1000,-1,1,0,0,0,nil,nil,nil,ST`;
  const b = new StoreBuilder();
  b.feed(`${stamp}ENCOUNTER_START,3513,"Kith'ix",16,22,3095`);
  b.feed(
    `${stamp}SPELL_CAST_SUCCESS,${owner},0000000000000000,nil,0x80000000,0x80000000,686,"Shadow Bolt",0x20,${adv('Player-61-0EDCA7E8', '0000000000000000')}`,
  );
  // The same felguard, written "Unknown" first, then by name.
  b.feed(hit(pet1, 'Unknown'));
  b.feed(hit(pet1, 'Ghaazhem'));
  // Another felguard of the same owner, never named in the pull.
  b.feed(hit(pet2, 'Unknown'));
  b.feed(`${stamp}ENCOUNTER_END,3513,"Kith'ix",16,22,0,1000`);
  const p = b.finish({
    id: 'x',
    label: 'Pull 1',
    encounterId: 3513,
    difficultyId: 16,
    startedAt: 0,
    result: 'wipe',
  });
  const names = p.units
    .filter((u) => u.guid.startsWith('Pet-'))
    .map((u) => u.name);
  expect(names).toEqual(['Ghaazhem', 'Ghaazhem']);
});
