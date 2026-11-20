import { RecStatus } from '../../main/types';
import type { PullUploadState } from '../../main/types';
import { checkServer } from '../../renderer/serverVersion';
import {
  EN_LABELS,
  pullLine,
  recorderLine,
  serverLine,
} from '../../renderer/sidebarStatus';

describe('recorderLine', () => {
  it('is green only when ready; waiting for WoW is a quiet grey', () => {
    expect(recorderLine(RecStatus.ReadyToRecord, '')).toEqual({
      tone: 'good',
      pulse: false,
      text: 'Ready to record',
    });
    expect(recorderLine(RecStatus.WaitingForWoW, '')).toEqual({
      tone: 'quiet',
      pulse: false,
      text: 'Waiting for WoW',
    });
  });

  it('uses the labels it is given', () => {
    const de = { ...EN_LABELS, ready: 'Bereit', notReady: 'Ungültig' };
    expect(recorderLine(RecStatus.ReadyToRecord, '', de).text).toBe('Bereit');
    expect(recorderLine(RecStatus.FatalError, 'x', de).text).toBe(
      'Ungültig: x',
    );
  });

  it('pulses brass while recording', () => {
    const line = recorderLine(RecStatus.Recording, '');
    expect(line.text).toBe('Recording');
    expect(line.tone).toBe('brass');
    expect(line.pulse).toBe(true);
  });

  it('says not ready with the reason, red', () => {
    const line = recorderLine(RecStatus.InvalidConfig, 'Log path\n  missing');
    expect(line).toEqual({
      tone: 'bad',
      pulse: false,
      text: 'Not ready: Log path missing',
    });
    expect(recorderLine(RecStatus.FatalError, '').text).toBe(
      'Not ready: recorder error',
    );
  });
});

describe('serverLine', () => {
  const current = checkServer('v1.9.146', '1.9.134');
  const behind = checkServer('1.9.120', '1.9.134');
  const unknown = checkServer(null);

  it('shows the version and who is signed in', () => {
    expect(
      serverLine({
        variant: 'connected',
        rowLabel: 'Connected',
        userName: 'Aldra',
        server: current,
      }),
    ).toEqual({
      tone: 'quiet',
      lead: 'Guild server 1.9.146',
      trail: 'signed in as Aldra',
    });
  });

  it('leaves the version out when it is not known', () => {
    const line = serverLine({
      variant: 'connected',
      rowLabel: 'Connected',
      userName: '',
      server: unknown,
    });
    expect(line.lead).toBe('Guild server');
    expect(line.trail).toBe('connected');
  });

  it('warns when the server is older than the last server change', () => {
    expect(
      serverLine({
        variant: 'connected',
        rowLabel: 'Connected',
        userName: 'Aldra',
        server: behind,
      }),
    ).toEqual({
      tone: 'warn',
      lead: 'Guild server 1.9.120',
      trail: 'needs an update',
    });
  });

  it('uses the short sign-in label otherwise', () => {
    expect(
      serverLine({
        variant: 'error',
        rowLabel: 'Offline, retrying',
        server: current,
      }),
    ).toEqual({
      tone: 'bad',
      lead: 'Guild server: Offline, retrying',
      trail: '',
    });
    expect(
      serverLine({
        variant: 'disconnected',
        rowLabel: 'Not signed in',
        server: current,
      }).tone,
    ).toBe('quiet');
  });
});

describe('pullLine', () => {
  const at = new Date(2026, 9, 21, 22, 41).getTime();
  const base: PullUploadState = {
    state: 'sent',
    encounterName: "Kith'ix",
    difficultyId: 16,
    result: 'wipe',
    at,
  };

  it('says nothing with no pull or nothing to act on', () => {
    expect(pullLine(null, '')).toBeNull();
    expect(pullLine({ ...base, state: 'otherRaider' }, '')).toBeNull();
    expect(pullLine({ ...base, state: 'skipped' }, '')).toBeNull();
  });

  it('is short, with the long sentence as the title', () => {
    const sent = pullLine(base, 'long');
    expect(sent?.text).toMatch(/^Last pull: sent /);
    expect(sent?.tone).toBe('quiet');
    expect(sent?.title).toBe('long');
    expect(pullLine({ ...base, state: 'queued' }, '')?.text).toBe(
      'Last pull: queued',
    );
    expect(pullLine({ ...base, state: 'uploading' }, '')?.tone).toBe('brass');
    expect(pullLine({ ...base, state: 'failed' }, '')?.tone).toBe('bad');
    expect(pullLine({ ...base, full: 'failed' }, '')?.tone).toBe('warn');
  });
});
