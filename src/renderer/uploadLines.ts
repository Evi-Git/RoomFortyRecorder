import type { PullUploadState } from 'main/types';
import { timeOfDay } from './clock';
import { friendlyError } from './friendlyError';
import type { BackfillFailure } from 'main/backfillFailure';

/**
 * [RoomFortyRecorder] One line about this PC's last pull upload, for under
 * "Send my Logs". `tone` picks the colour.
 */
export type UploadLine = {
  tone: 'busy' | 'good' | 'quiet' | 'warn' | 'bad';
  text: string;
};

export const describeUpload = (u: PullUploadState): UploadLine => {
  const what = `${u.encounterName} ${u.result}`;
  const when = `${what} (${timeOfDay(u.at)})`;
  switch (u.state) {
    case 'waiting':
      return { tone: 'busy', text: `${what}: asking the guild server…` };
    case 'queued':
      return {
        tone: 'warn',
        text: `${when}: waiting for the guild server. It will be sent when it's back.`,
      };
    case 'uploading':
      return { tone: 'busy', text: `${what}: sending your log…` };
    case 'retrying':
      return {
        tone: 'busy',
        text: `${what}: couldn't send yet, trying again${u.attempt ? ` (try ${u.attempt + 1})` : ''}…`,
      };
    case 'sent':
      if (u.full === 'failed') {
        return {
          tone: 'warn',
          text: `${when}: your log was used. The full log wasn't sent; it's tried again automatically later.`,
        };
      }
      if (u.full === 'refused') {
        return {
          tone: 'warn',
          text: `${when}: your log was used. The server didn't accept the full log.`,
        };
      }
      if (u.full === 'later') {
        return {
          tone: 'good',
          text: `${when}: your log was used. The full log will be sent by the automatic check.`,
        };
      }
      if (u.full === 'sending') {
        return {
          tone: 'good',
          text: `${when}: your log was used. Sending the full log…`,
        };
      }
      return { tone: 'good', text: `${when}: your log was used.` };
    case 'otherRaider':
      return { tone: 'quiet', text: `${when}: another raider's log was used.` };
    case 'undecided':
      return {
        tone: 'quiet',
        text: `${when}: the server was still deciding; it's checked again after raid.`,
      };
    case 'skipped':
      return {
        tone: 'quiet',
        text: `${when}: a difficulty the guild doesn't track.`,
      };
    case 'notSignedIn':
      return {
        tone: 'warn',
        text: `${when}: not sent. Sign in with Discord in Cloud settings.`,
      };
    case 'failed':
    default:
      return {
        tone: 'bad',
        text: `${when}: couldn't send${u.error ? ` (${u.error})` : ''}. It's sent again automatically later.`,
      };
  }
};

export const describeBackfill = (
  b: { at: number; uploaded: number; files: number } | null,
) => {
  if (!b) return null;
  const sent = b.uploaded
    ? `sent ${b.uploaded} missing ${b.uploaded === 1 ? 'pull' : 'pulls'}`
    : 'nothing was missing';
  return `Saved combat logs checked at ${timeOfDay(b.at)}: ${sent}.`;
};

/**
 * One line for a failed automatic check of saved combat logs, or null.
 * "Paused" (a pull started) never gets here: it isn't a failure.
 */
export const describeBackfillFailure = (
  f: BackfillFailure | null | undefined,
): string | null => {
  if (!f) return null;
  const at = timeOfDay(f.at);
  const n = f.count ?? 0;
  switch (f.kind) {
    case 'notSignedIn':
      return `Saved combat logs weren't checked at ${at}: sign in with Discord in Cloud settings.`;
    case 'someFailed':
      return `Saved combat logs checked at ${at}: ${n} ${n === 1 ? 'pull' : 'pulls'} couldn't be sent. They're tried again automatically.`;
    case 'gaveUp':
      return `Saved combat logs checked at ${at}: ${n === 1 ? 'a log file keeps' : `${n} log files keep`} failing, so the app stopped retrying ${n === 1 ? 'it' : 'them'}.`;
    case 'error':
    default:
      return `Saved combat logs weren't checked at ${at}: ${friendlyError(f.reason)}`;
  }
};
