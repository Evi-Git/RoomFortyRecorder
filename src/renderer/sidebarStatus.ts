import { RecStatus } from '../main/types';
import type { PullUploadState } from '../main/types';
import type { ServerCheck } from './serverVersion';
import { timeOfDay } from './clock';

/**
 * [RoomFortyRecorder] What the sidebar's status card says, as plain data so
 * it can be tested: line 1 (is the app ready to record), line 2 (guild
 * server version and who you're signed in as) and line 3 (the last pull).
 */

export type Tone = 'good' | 'brass' | 'bad' | 'warn' | 'quiet';

export type RecorderLine = {
  tone: Tone;
  /** The dot pulses. */
  pulse: boolean;
  text: string;
};

/**
 * Line 1. Waiting for WoW counts as ready: the app is set up and will start
 * by itself. `error` is the recorder's own message for the two broken states.
 */
export const recorderLine = (
  status: RecStatus,
  error: string,
): RecorderLine => {
  const reason = (fallback: string) => {
    const text = (error || '').replace(/\s+/g, ' ').trim();
    return `Not ready: ${text || fallback}`;
  };
  switch (status) {
    case RecStatus.Recording:
      return { tone: 'brass', pulse: true, text: 'Recording' };
    case RecStatus.ReadyToRecord:
    case RecStatus.WaitingForWoW:
      return { tone: 'good', pulse: false, text: 'Ready to record' };
    case RecStatus.InvalidConfig:
      return {
        tone: 'bad',
        pulse: false,
        text: reason('settings need a look'),
      };
    case RecStatus.FatalError:
      return { tone: 'bad', pulse: false, text: reason('recorder error') };
    case RecStatus.Overrunning:
      return { tone: 'warn', pulse: true, text: 'Finishing the recording' };
    case RecStatus.Reconfiguring:
    default:
      return { tone: 'quiet', pulse: true, text: 'Getting ready…' };
  }
};

export type ServerLine = {
  tone: Tone;
  /** "Guild server 1.9.146", or the short sign-in label. */
  lead: string;
  /** "signed in as Name" / "needs an update"; empty when there's none. */
  trail: string;
};

/**
 * Line 2. `variant` is CloudStatus's own reading of the sign-in state;
 * `rowLabel` is its short label for the states that aren't "connected".
 */
export const serverLine = (input: {
  variant: 'connected' | 'active' | 'disconnected' | 'error';
  rowLabel: string;
  userName?: string;
  server: ServerCheck;
}): ServerLine => {
  const { variant, rowLabel, userName, server } = input;
  if (variant === 'connected' || variant === 'active') {
    const lead =
      server.state === 'unknown'
        ? 'Guild server'
        : `Guild server ${server.server}`;
    if (server.state === 'behind') {
      return { tone: 'warn', lead, trail: 'needs an update' };
    }
    return {
      tone: 'quiet',
      lead,
      trail: userName ? `signed in as ${userName}` : 'connected',
    };
  }
  return {
    tone: variant === 'error' ? 'bad' : 'quiet',
    lead: rowLabel,
    trail: '',
  };
};

export type PullLine = { tone: Tone; text: string; title: string };

/**
 * Line 3: the last pull this PC sent, short. `title` carries the longer
 * sentence (the same one "Send my Logs" shows in Settings).
 */
export const pullLine = (
  u: PullUploadState | null | undefined,
  detail: string,
): PullLine | null => {
  if (!u) return null;
  const at = timeOfDay(u.at);
  switch (u.state) {
    case 'waiting':
    case 'uploading':
    case 'retrying':
      return { tone: 'brass', text: 'Sending the last pull…', title: detail };
    case 'queued':
      return { tone: 'warn', text: 'Last pull: queued', title: detail };
    case 'sent':
      if (u.full === 'failed' || u.full === 'refused') {
        return { tone: 'warn', text: `Last pull: sent ${at}`, title: detail };
      }
      return { tone: 'quiet', text: `Last pull: sent ${at}`, title: detail };
    case 'notSignedIn':
      return { tone: 'warn', text: 'Last pull: not sent', title: detail };
    case 'failed':
      return { tone: 'bad', text: 'Last pull: not sent', title: detail };
    default:
      // Another raider's log, undecided, skipped: nothing to act on.
      return null;
  }
};
