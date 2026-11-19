import { isReset, RESET_SECONDS } from '../../renderer/resets';
import { READABLE_CLASS_COLOR } from '../../renderer/classColors';

/** WCAG contrast ratio of two #RRGGBB colours. */
const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('resets', () => {
  it('treats pulls under 10 s as resets', () => {
    expect(RESET_SECONDS).toBe(10);
    expect(isReset({ duration: 0 })).toBe(true);
    expect(isReset({ duration: 9.9 })).toBe(true);
    expect(isReset({ duration: 10 })).toBe(false);
    expect(isReset({ duration: 292 })).toBe(false);
  });

  it('never hides a pull with no known duration', () => {
    expect(isReset({})).toBe(false);
    expect(isReset({ duration: null })).toBe(false);
  });
});

describe('readable class colours', () => {
  // A selected row (`panel-line`) is the darkest-contrast place they sit.
  it.each(
    Object.entries(READABLE_CLASS_COLOR).filter(([k]) => k !== 'UNKNOWN'),
  )('%s reads at 4.5:1 or better on a selected row', (_cls, colour) => {
    expect(contrast(colour, '#2A2521')).toBeGreaterThanOrEqual(4.5);
  });
});
