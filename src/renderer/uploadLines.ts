import type { PullUploadState } from 'main/types';
import { timeOfDay } from './clock';

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
