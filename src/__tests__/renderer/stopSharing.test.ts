import {
  showStopSharing,
  stopSharingDone,
  stopSharingLabel,
} from '../../renderer/stopSharing';

describe('Stop sharing button', () => {
  it('shows for a shared recording, or one with clips, when allowed', () => {
    expect(showStopSharing({ shared: true, canStopSharing: true })).toBe(true);
    expect(showStopSharing({ clipLinks: 2, canStopSharing: true })).toBe(true);
    expect(showStopSharing({ shared: false, clipLinks: 0 })).toBe(false);
    expect(showStopSharing(undefined)).toBe(false);
  });

  it('hides when the server says this person may not stop it', () => {
    expect(showStopSharing({ shared: true, canStopSharing: false })).toBe(
      false,
    );
    expect(showStopSharing({ clipLinks: 3, canStopSharing: false })).toBe(
      false,
    );
  });

  it('an older server (no canStopSharing) behaves as before', () => {
    expect(showStopSharing({ shared: true })).toBe(true);
    expect(showStopSharing({ shared: false })).toBe(false);
  });

  it('labels the recording link alone and with clips', () => {
    expect(stopSharingLabel({ shared: true })).toBe(
      'Stop sharing: the public link stops working',
    );
    expect(stopSharingLabel({ shared: true, clipLinks: 1 })).toBe(
      'Stop sharing: the public link and 1 clip sent to Discord stop working',
    );
    expect(stopSharingLabel({ shared: true, clipLinks: 2 })).toBe(
      'Stop sharing: the public link and 2 clips sent to Discord stop working',
    );
    expect(stopSharingLabel({ shared: false, clipLinks: 1 })).toBe(
      'Stop sharing: 1 clip sent to Discord stops working',
    );
  });

  it('the toast mentions clips only when some were stopped', () => {
    expect(stopSharingDone(undefined)).toMatch(
      /^The public link no longer works\./,
    );
    expect(stopSharingDone(0)).toMatch(/^The public link no longer works\./);
    expect(stopSharingDone(2)).toMatch(
      /^The public link and 2 clips sent to Discord no longer work\. Someone already watching/,
    );
    expect(stopSharingDone(1)).toMatch(
      /and 1 clip sent to Discord no longer work/,
    );
  });
});
