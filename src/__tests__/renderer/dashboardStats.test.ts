import {
  avoidableStat,
  compactRate,
  consumablesStat,
  deathsStat,
  raidDpsStat,
} from '../../renderer/dashboard/stats';

describe('compactRate', () => {
  it('shortens big numbers', () => {
    expect(compactRate(1820000)).toBe('1.82M');
    expect(compactRate(94300)).toBe('94.3k');
    expect(compactRate(812.4)).toBe('812');
  });
});

describe('raidDpsStat', () => {
  it('adds everyone up over the duration', () => {
    const stat = raidDpsStat({
      duration: 100,
      damage: [{ total: 60e6 }, { total: 40e6 }],
    });
    expect(stat?.value).toBe('1.00M');
    expect(stat?.note).toBe('100.00M damage in 1:40');
  });
  it('is hidden without data', () => {
    expect(raidDpsStat(null)).toBeNull();
    expect(raidDpsStat({ duration: 0, damage: [{ total: 5 }] })).toBeNull();
    expect(raidDpsStat({ duration: 60, damage: [] })).toBeNull();
    expect(raidDpsStat({ duration: 60, damage: [{ total: 0 }] })).toBeNull();
  });
});

describe('deathsStat', () => {
  it('names the first death', () => {
    expect(deathsStat([{ t: 200 }, { t: 119 }])).toEqual({
      value: '2',
      note: 'first at 1:59',
    });
  });
  it('says so when nobody died', () => {
    expect(deathsStat([])).toEqual({ value: '0', note: 'no deaths' });
  });
});

describe('avoidableStat', () => {
  it('names the spell with the most hits across raiders', () => {
    const stat = avoidableStat([
      {
        hits: 3,
        bySpell: {},
        spells: [
          { spellId: 1, spellName: 'Void Pool', hits: 2 },
          { spellId: 2, spellName: 'Cleave', hits: 1 },
        ],
      },
      {
        hits: 2,
        bySpell: {},
        spells: [{ spellId: 2, spellName: 'Cleave', hits: 2 }],
      },
    ]);
    expect(stat).toEqual({ value: '5', note: '3 on Cleave' });
  });
  it('reads older reports that only have counts', () => {
    const stat = avoidableStat([{ hits: 4, bySpell: { '9': 4 } }], {
      '9': 'Flame',
    });
    expect(stat).toEqual({ value: '4', note: '4 on Flame' });
    expect(avoidableStat([{ hits: 1, bySpell: { '7': 1 } }]).note).toBe(
      '1 on Spell 7',
    );
  });
  it('says none for no hits', () => {
    expect(avoidableStat([])).toEqual({ value: '0', note: 'none' });
  });
});

describe('consumablesStat', () => {
  it('is hidden without prep', () => {
    expect(consumablesStat(null)).toBeNull();
    expect(consumablesStat({ players: [] })).toBeNull();
  });
  it('counts raiders with flask and food', () => {
    const all = consumablesStat({
      players: [
        { food: 'a', flask: 'b' },
        { food: 'a', flask: 'b' },
      ],
    });
    expect(all).toEqual({ value: '2 / 2', note: 'all flasks and food' });
    const some = consumablesStat({
      players: [
        { food: null, flask: 'b' },
        { food: null, flask: null },
        { food: 'a', flask: 'b' },
      ],
    });
    expect(some).toEqual({
      value: '1 / 3',
      note: '1 missing flask, 2 missing food',
    });
  });
});
