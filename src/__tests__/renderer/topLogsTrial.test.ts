import {
  amountAt,
  gapSeries,
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
