import { RecStatus } from '../main/types';
import type { PullUploadState } from '../main/types';
import type { ServerCheck } from './serverVersion';
import { timeOfDay } from './clock';

/**
 * [RoomFortyRecorder] What the sidebar's status card says, as plain data so
 * it can be tested: line 1 (is the app ready to record), line 2 (guild
 * server version and who you're signed in as) and line 3 (the last pull).
 */

export type SidebarLabels = {
  ready: string;
  waiting: string;
  recording: string;
  notReady: string;
  finishing: string;
  gettingReady: string;
  guildServer: string;
  lastPull: string;
  needsUpdate: string;
  signedInAs: string;
  sent: string;
  queued: string;
  notSent: string;
  sending: string;
  connected: string;
};

/** English; the app passes its own language's (sidebarLabels.ts). */
export const EN_LABELS: SidebarLabels = {
  ready: 'Ready to record',
  waiting: 'Waiting for WoW',
  recording: 'Recording',
  notReady: 'Not ready',
  finishing: 'Finishing the recording',
  gettingReady: 'Getting ready…',
  guildServer: 'Guild server',
  lastPull: 'Last pull',
  needsUpdate: 'needs an update',
  signedInAs: 'signed in as',
  sent: 'sent',
  queued: 'queued',
  notSent: 'not sent',
  sending: 'Sending the last pull…',
  connected: 'connected',
};

export type Tone = 'good' | 'brass' | 'bad' | 'warn' | 'quiet';

export type RecorderLine = {
  tone: Tone;
  /** The dot pulses. */
  pulse: boolean;
  text: string;
};

/**
 * Line 1. Only ReadyToRecord is green: while waiting for WoW the dot is grey,
 * so a raider in game can tell the recorder hasn't seen the game.
 * `error` is the recorder's own message for the two broken states.
 */
export const recorderLine = (
  status: RecStatus,
  error: string,
  labels: SidebarLabels = EN_LABELS,
): RecorderLine => {
  const reason = (fallback: string) => {
    const text = (error || '').replace(/\s+/g, ' ').trim();
    return `${labels.notReady}: ${text || fallback}`;
  };
  switch (status) {
    case RecStatus.Recording:
      return { tone: 'brass', pulse: true, text: labels.recording };
    case RecStatus.ReadyToRecord:
      return { tone: 'good', pulse: false, text: labels.ready };
    case RecStatus.WaitingForWoW:
      return { tone: 'quiet', pulse: false, text: labels.waiting };
    case RecStatus.InvalidConfig:
      return {
        tone: 'bad',
        pulse: false,
        text: reason('settings need a look'),
      };
    case RecStatus.FatalError:
      return { tone: 'bad', pulse: false, text: reason('recorder error') };
    case RecStatus.Overrunning:
      return { tone: 'warn', pulse: true, text: labels.finishing };
    case RecStatus.Reconfiguring:
    default:
      return { tone: 'quiet', pulse: true, text: labels.gettingReady };
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
  labels?: SidebarLabels;
}): ServerLine => {
  const { variant, rowLabel, userName, server, labels = EN_LABELS } = input;
  if (variant === 'connected' || variant === 'active') {
    const lead =
      server.state === 'unknown'
        ? labels.guildServer
        : `${labels.guildServer} ${server.server}`;
    if (server.state === 'behind') {
      return { tone: 'warn', lead, trail: labels.needsUpdate };
    }
    return {
      tone: 'quiet',
      lead,
      trail: userName ? `${labels.signedInAs} ${userName}` : labels.connected,
    };
  }
  return {
    tone: variant === 'error' ? 'bad' : 'quiet',
    lead: `${labels.guildServer}: ${rowLabel}`,
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
  labels: SidebarLabels = EN_LABELS,
): PullLine | null => {
  const lp = labels.lastPull;
  if (!u) return null;
  const at = timeOfDay(u.at);
  switch (u.state) {
    case 'waiting':
    case 'uploading':
    case 'retrying':
      return { tone: 'brass', text: labels.sending, title: detail };
    case 'queued':
      return { tone: 'warn', text: `${lp}: ${labels.queued}`, title: detail };
    case 'sent':
      if (u.full === 'failed' || u.full === 'refused') {
        return {
          tone: 'warn',
          text: `${lp}: ${labels.sent} ${at}`,
          title: detail,
        };
      }
      return {
        tone: 'quiet',
        text: `${lp}: ${labels.sent} ${at}`,
        title: detail,
      };
    case 'notSignedIn':
      return { tone: 'warn', text: `${lp}: ${labels.notSent}`, title: detail };
    case 'failed':
      return { tone: 'bad', text: `${lp}: ${labels.notSent}`, title: detail };
    default:
      // Another raider's log, undecided, skipped: nothing to act on.
      return null;
  }
};
