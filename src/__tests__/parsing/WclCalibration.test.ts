import fs from 'fs';
import path from 'path';
import { StoreBuilder, F, K } from '../../renderer/logs/store';
import {
  DEFAULT_FILTERS,
  groupAbilities,
  makeCtx,
  meterRows,
} from '../../renderer/logs/query';

/**
 * [RoomFortyRecorder] Lines cut from the Mythic Kith'ix kill (WCL
 * bH7Mh4AQpxfP3Gkq fight 43), where our numbers were checked against
 * Warcraft Logs': support damage, deferred shields, health moved between
 * raiders, cheat-death saves, healers' healing on others' pets.
 */
const store = () => {
  const b = new StoreBuilder();
  fs.readFileSync(
    path.join(__dirname, '../../../tests/logs/retail/kithix_calibration.txt'),
    'utf8',
  )
    .split('\n')
    .forEach((l) => l && b.feed(l));
  return b.finish({
    id: 'k',
    label: 'Pull 34',
    encounterId: 3513,
    difficultyId: 233,
    startedAt: 0,
    result: 'kill',
  });
};

const row = (meter: 'damage' | 'healing' | 'taken', name: string) => {
  const p = store();
  return meterRows(makeCtx([p], DEFAULT_FILTERS), meter).find(
    (r) => r.name === name,
  );
};

const ability = (
  meter: 'damage' | 'healing' | 'taken',
  name: string,
  spell: string,
) =>
  [...(row(meter, name)?.abilities.values() ?? [])]
    .filter((a) => a.name === spell)
    .reduce((n, a) => n + a.total, 0);

test('support damage (Bombardments) counts for the evoker', () => {
  expect(ability('damage', 'Glaividblowy', 'Bombardments')).toBeGreaterThan(0);
  expect(ability('damage', 'Puchador', 'Bombardments')).toBe(0);
  expect(ability('damage', 'Jawnathanx', 'Bombardments')).toBe(0);
});

test('Refractive Images is neither healing nor damage taken', () => {
  expect(ability('healing', 'Lamplightr', 'Refractive Images')).toBe(0);
  const p = store();
  let soaked = 0;
  let hit = 0;
  for (let i = 0; i < p.n; i += 1) {
    if (p.k[i] === K.ABSORB && p.spells[p.sp[i]].name === 'Refractive Images')
      soaked += p.a[i];
    if (
      p.k[i] === K.DMG &&
      p.spells[p.sp[i]].name === 'Seriously Sharp Seashell' &&
      p.units[p.d[i]].name === 'Lamplightr'
    )
      hit += p.a[i] + p.b[i];
  }
  expect(soaked).toBeGreaterThan(0);
  // The soaked part comes off the hit it soaked.
  expect(ability('taken', 'Lamplightr', 'Seriously Sharp Seashell')).toBe(
    hit - soaked,
  );
});

test('Spirit Link and Tempered in Battle are not damage taken', () => {
  expect(ability('taken', 'Skippydh', 'Spirit Link')).toBe(0);
  expect(ability('taken', 'Evipaladin', 'Tempered in Battle')).toBe(0);
  expect(ability('taken', 'Pauliewarrie', 'Tempered in Battle')).toBe(0);
});

test('cheat-death saves are not healing', () => {
  expect(ability('healing', 'Shadeaux', 'Guardian Spirit')).toBe(0);
  expect(ability('healing', 'Zømbicidal', 'Purgatory')).toBe(0);
});

test("a healer's healing on another raider's pet doesn't count, a DPS's does", () => {
  expect(ability('healing', 'Azraelus', 'Emerald Blossom')).toBe(0);
  expect(ability('healing', 'Angxl', 'Halo')).toBeGreaterThan(0);
});

test('Twin Flame is not a cast', () => {
  const p = store();
  for (let i = 0; i < p.n; i += 1)
    if (p.k[i] === K.CAST && p.spells[p.sp[i]].id === 1265991)
      expect(p.f[i] & F.PROC).toBeTruthy();
});

test('a nested parent groups every raider-side part, and heal + shield share a row', () => {
  const groups = groupAbilities(
    [
      {
        key: 'a',
        spellId: 1280460,
        name: 'Mind Sear',
        by: 'Antoran Inquisitor',
        total: 10,
      },
      { key: 'b', spellId: 1282534, name: 'Blaze', by: 'Alythess', total: 5 },
      {
        key: 'c',
        spellId: 428487,
        name: 'Exhilarating Execution',
        by: '',
        kind: 'heal',
        total: 3,
      },
      {
        key: 'd',
        spellId: 428488,
        name: 'Exhilarating Execution',
        by: '',
        kind: 'shield',
        total: 2,
      },
    ].map((a) => ({
      casts: 0,
      hits: 1,
      crits: 0,
      ticks: 0,
      misses: 0,
      overheal: 0,
      absorbed: 0,
      mitigated: 0,
      uptime: 0,
      ...a,
    })) as never,
  );
  const byName = new Map(groups.map((g) => [g.head.name, g.head.total]));
  expect(byName.get('Dominion of Argus')).toBe(15);
  expect(byName.get('Exhilarating Execution')).toBe(5);
});

test('buffs from before the pull (COMBATANT_INFO) last the whole fight', () => {
  const p = store();
  const lamp = p.units.findIndex((u) => u.name === 'Lamplightr');
  const vantus = p.auras.find(
    (a) => a.dst === lamp && p.spells[a.spell].id === 1303171,
  );
  expect(vantus?.start).toBe(0);
  expect(vantus?.end).toBeCloseTo(p.duration, 1);
});
