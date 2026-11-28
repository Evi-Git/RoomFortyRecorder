import {
  shareStateKey,
  showStopSharing,
  stopSharingDone,
  stopSharingLabel,
} from '../../renderer/stopSharing';

describe('Stop sharing button (1.9.168)', () => {
  it('shows when this person may stop something', () => {
    expect(
      showStopSharing({ shared: true, stopsLink: true, canStopSharing: true }),
    ).toBe(true);
    expect(showStopSharing({ stopsClips: 2, canStopSharing: true })).toBe(true);
  });

  it('hides when this person may not, even if links exist', () => {
    expect(
      showStopSharing({
        shared: true,
        stopsLink: false,
        stopsClips: 0,
        canStopSharing: false,
      }),
    ).toBe(false);
    expect(showStopSharing(null)).toBe(false);
  });

  it('an older server (no canStopSharing) behaves as before', () => {
    expect(showStopSharing({ shared: true })).toBe(true);
    expect(showStopSharing({ shared: false })).toBe(false);
    expect(stopSharingLabel({ shared: true })).toBe(
      'Stop sharing: the public link stops working',
    );
  });

  it('the label only names what this person may stop', () => {
    const label = (stopsLink: boolean, stopsClips: number) =>
      stopSharingLabel({
        shared: true,
        stopsLink,
        stopsClips,
        canStopSharing: true,
      });
    expect(label(true, 0)).toBe('Stop sharing: the public link stops working');
    expect(label(true, 1)).toBe(
      'Stop sharing: the public link and 1 clip sent to Discord stop working',
    );
    expect(label(true, 3)).toBe(
      'Stop sharing: the public link and 3 clips sent to Discord stop working',
    );
    // A raider who only sent a clip of someone else's shared recording.
    expect(label(false, 1)).toBe(
      'Stop sharing: 1 clip sent to Discord stops working',
    );
    expect(label(false, 2)).toBe(
      'Stop sharing: 2 clips sent to Discord stop working',
    );
  });

  it('the message afterwards says what was taken down', () => {
    expect(stopSharingDone(1, 0)).toMatch(
      /^The public link no longer works\. /,
    );
    expect(stopSharingDone(1, 2)).toMatch(
      /^The public link and 2 clips sent to Discord no longer work\. /,
    );
    expect(stopSharingDone(0, 1)).toMatch(
      /^1 clip sent to Discord no longer works\. /,
    );
    expect(stopSharingDone(0, 3)).toMatch(
      /^3 clips sent to Discord no longer work\. /,
    );
    // Older servers: { removed } only, or nothing.
    expect(stopSharingDone(1, undefined)).toMatch(
      /^The public link no longer works\. /,
    );
    expect(stopSharingDone(undefined, undefined)).toMatch(
      /^The public link no longer works\. /,
    );
  });

  it('the share-state key changes when the list brings new share fields', () => {
    const before = {
      videoName: 'a.mp4',
      shared: true,
      stopsLink: true,
      stopsClips: 1,
      canStopSharing: true,
    };
    const after = {
      videoName: 'a.mp4',
      shared: false,
      stopsLink: false,
      stopsClips: 0,
      canStopSharing: false,
    };
    expect(shareStateKey(before)).toBe(shareStateKey({ ...before }));
    expect(shareStateKey(before)).not.toBe(shareStateKey(after));
    expect(shareStateKey(before)).not.toBe(
      shareStateKey({ ...before, videoName: 'b.mp4' }),
    );
  });
});
