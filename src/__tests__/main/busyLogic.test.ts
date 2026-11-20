import {
  busyDialogButtons,
  busyReasonFrom,
  DeferredAction,
  mayDownloadUpdate,
} from '../../main/busyLogic';

const idle = {
  activity: null,
  capturingPull: false,
  live: false,
  saving: 0,
  uploading: 0,
};

describe('busyReasonFrom', () => {
  it('is null when idle', () => {
    expect(busyReasonFrom(idle)).toBeNull();
  });

  it('names the activity being recorded', () => {
    expect(busyReasonFrom({ ...idle, activity: { category: 'Raids' } })).toBe(
      'A pull is being recorded.',
    );
    expect(busyReasonFrom({ ...idle, activity: { category: 'Mythic+' } })).toBe(
      'A Mythic+ run is being recorded.',
    );
    expect(busyReasonFrom({ ...idle, activity: { category: 'Manual' } })).toBe(
      'A recording is in progress.',
    );
  });

  it('counts a pull log being sent, after recordings', () => {
    expect(busyReasonFrom({ ...idle, sendingLog: 1 })).toBe(
      "A pull's log is being sent.",
    );
    expect(busyReasonFrom({ ...idle, sendingLog: 0 })).toBeNull();
    expect(busyReasonFrom({ ...idle, uploading: 1, sendingLog: 1 })).toBe(
      'A recording is uploading.',
    );
  });

  it('covers log capture, live, saving and uploading', () => {
    expect(busyReasonFrom({ ...idle, capturingPull: true })).toBe(
      'A pull is being recorded.',
    );
    expect(busyReasonFrom({ ...idle, live: true })).toBe("You're live.");
    expect(busyReasonFrom({ ...idle, saving: 1 })).toBe(
      'A recording is still being saved.',
    );
    expect(busyReasonFrom({ ...idle, uploading: 2 })).toBe(
      'A recording is uploading.',
    );
  });

  it('counts the end-of-pull window as saving', () => {
    expect(busyReasonFrom({ ...idle, finishing: true })).toBe(
      'A recording is still being saved.',
    );
  });

  it('prefers the most costly reason', () => {
    expect(
      busyReasonFrom({
        ...idle,
        live: true,
        uploading: 1,
        activity: { category: 'Raids' },
      }),
    ).toBe('A pull is being recorded.');
  });
});

describe('DeferredAction', () => {
  it('fires once when the busy reason clears', () => {
    const d = new DeferredAction();
    d.request('quit');
    expect(d.tick('A pull is being recorded.')).toBeNull();
    expect(d.current).toBe('quit');
    expect(d.tick(null)).toBe('quit');
    expect(d.tick(null)).toBeNull();
    expect(d.current).toBeNull();
  });

  it('does nothing when nothing is pending or after cancel', () => {
    const d = new DeferredAction();
    expect(d.tick(null)).toBeNull();
    d.request('install');
    d.cancel();
    expect(d.tick(null)).toBeNull();
  });

  it('lets a later request replace the earlier one', () => {
    const d = new DeferredAction();
    d.request('quit');
    d.request('install');
    expect(d.tick(null)).toBe('install');
  });
});

describe('busyDialogButtons', () => {
  it('offers wait, now, cancel the first time', () => {
    expect(busyDialogButtons('quit', false)).toEqual({
      labels: ["Quit when it's done", 'Quit now', 'Cancel'],
      choices: ['wait', 'now', 'cancel'],
    });
    expect(busyDialogButtons('install', false).labels[0]).toBe(
      "Install when it's done",
    );
  });

  it('offers now or keep waiting while waiting', () => {
    expect(busyDialogButtons('quit', true)).toEqual({
      labels: ['Quit now', 'Keep waiting', "Don't quit"],
      choices: ['now', 'cancel', 'stop'],
    });
  });
});

describe('mayDownloadUpdate', () => {
  it('waits while busy unless the user asked', () => {
    expect(mayDownloadUpdate("You're live.", false)).toBe(false);
    expect(mayDownloadUpdate("You're live.", true)).toBe(true);
    expect(mayDownloadUpdate(null, false)).toBe(true);
  });
});
