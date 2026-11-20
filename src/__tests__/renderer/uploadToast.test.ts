import {
  failureToastText,
  nextTally,
  TOAST_WINDOW_MS,
} from '../../renderer/uploadToast';

describe('upload failure toasts', () => {
  it('counts failures that follow each other, restarts after a gap', () => {
    const a = nextTally(null, 1000);
    expect(a.count).toBe(1);
    const b = nextTally(a, 1000 + TOAST_WINDOW_MS - 1);
    expect(b.count).toBe(2);
    const c = nextTally(b, b.at + TOAST_WINDOW_MS);
    expect(c.count).toBe(1);
  });

  it('keeps the first toast specific and later ones as a count', () => {
    expect(failureToastText(1, { name: "Ula'tek", message: 'Nope.' })).toEqual({
      title: 'A recording did not upload',
      description: "Ula'tek: Nope.",
    });
    expect(failureToastText(3, {}).title).toBe('3 recordings did not upload');
  });
});
