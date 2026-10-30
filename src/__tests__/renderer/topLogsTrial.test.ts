import {
  amountAt,
  gapSeries,
  insights,
  rate,
  wclUrl,
  Track,
  vodInfo,
} from '../../renderer/toplogs/trial';

const track = (
  name: string,
  perSecond: number[],
  casts: [number, number][] = [],
): Track => {
  let sum = 0;
  return {
    name,
    duration: perSecond.length,
    amounts: perSecond.map((v) => {
      sum += v;
      return sum;
    }),
    casts,
  };
};

describe('time trial math', () => {
  test('amounts and gap', () => {
    const you = track('You', [10, 10, 10]);
    const them = track('Them', [10, 20, 30, 40]);
    expect(amountAt(you, 0)).toBe(0);
    expect(amountAt(you, 2)).toBe(20);
    expect(amountAt(you, 99)).toBe(30);
    expect(gapSeries(you, them)).toEqual([0, -10, -30]);
    expect(rate(them)).toBe(25);
  });

  test('insights: where they pulled ahead, late and missing cooldowns, pace', () => {
    const flat = Array.from({ length: 120 }, () => 100);
    const theirs = flat.map((v, i) => (i >= 60 && i < 80 ? 600 : v));
    const you = track('You', flat, [
      [20, 1],
      [0, 3],
      [61, 3],
    ]);
    const them = track('Them', theirs, [
      [2, 1],
      [0, 2],
      [61, 2],
      [0, 3],
      [30, 3],
      [61, 3],
      [90, 3],
    ]);
    const cds = [1, 2, 3].map((spellId) => ({
      spellId,
      share: 1,
      medianGap: 60,
      medianCasts: 2,
      medianFirst: 0,
      cooldown: 60,
    }));
    const list = insights(you, them, cds, {
      1: 'Avatar',
      2: 'Recklessness',
      3: 'Bladestorm',
    });
    const texts = list.map((i) => i.text);
    expect(texts[0]).toBe('1:00–1:20: they pulled 10k ahead.');
    expect(texts).toContain(
      'Avatar: your first one was 18 s later (0:20 vs 0:02).',
    );
    expect(texts).toContain("Recklessness: they pressed it 2×, you didn't.");
    expect(texts).toContain('Bladestorm: 2 vs their 4 casts.');
    expect(texts[texts.length - 1]).toMatch(
      /^Overall: 100 vs 183 per second \(-45\.5%\)/,
    );
  });

  test('Warcraft Logs link', () => {
    expect(wclUrl('AbCd1234', 7, 'hps')).toBe(
      'https://www.warcraftlogs.com/reports/AbCd1234#fight=7&type=healing',
    );
  });
});

describe('vodInfo (Race me: our VoD button)', () => {
  it("names the raider when it's their recording", () => {
    const v = vodInfo('Jawnathanx', 'Jawnathanx');
    expect(v.label).toBe("Watch Jawnathanx's VoD");
    expect(v.tip).toMatch(/Click the race chart/);
  });
  it("falls back to someone else's recording and says so", () => {
    const v = vodInfo('Puzzlebox', 'Jawnathanx');
    expect(v.label).toBe('Watch our VoD');
    expect(v.tip).toMatch(
      /Jawnathanx has no recording of this pull; opens Puzzlebox's/,
    );
  });
  it('greys out with a reason when nobody recorded the pull', () => {
    const v = vodInfo(null, 'Jawnathanx');
    expect(v.owner).toBeNull();
    expect(v.tip).toMatch(/No recording of this pull/);
  });
});
