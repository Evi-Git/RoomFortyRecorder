/**
 * [RoomFortyRecorder] Copy for NSRT (1.9.104): a Northern Sky Raid Tools
 * reminder string from a Time trial, so a raider gets "press X now" at the
 * top player's timings in game. Pure for tests (nsrt.test.ts).
 *
 * The format (NSRT's import, as wowutils exports it):
 *   EncounterID:3513;Difficulty:Mythic;Name:Kith'ix;
 *   time:13;ph:1;tag:Jawnathanx;spellid:51271;
 * `time` is seconds into phase `ph` (NSRT follows the boss mod's phases).
 * By phase uses Warcraft Logs' phase IDs; "From the pull" puts everything
 * in phase 1 with times from the pull, which works whatever the phases.
 */
import type { Phase } from './timeline';

export type NsrtOptions = {
  encounterId: number;
  difficultyId: number;
  bossName: string;
  /** Who it's for: a character name, or NSRT's tags (melee, healer...). */
  tag: string;
  /** [seconds from the pull, spell ID to show] */
  casts: [number, number][];
  /** Phases to time from; empty: from the pull. */
  phases: Phase[];
  /** Seconds to show the reminder before the cast (NSRT's countdown). */
  countdown?: number;
};

const DIFFICULTY: Record<number, string> = {
  16: 'Mythic',
  233: 'Mythic',
  15: 'Heroic',
  14: 'Normal',
};

/** NSRT splits on ";" and ":"; keep names safe. */
const clean = (s: string) => s.replace(/[;:\n\r]/g, ' ').trim();

export const nsrtString = ({
  encounterId,
  difficultyId,
  bossName,
  tag,
  casts,
  phases,
  countdown,
}: NsrtOptions) => {
  const head = `EncounterID:${encounterId};Difficulty:${
    DIFFICULTY[difficultyId] ?? 'Mythic'
  };Name:${clean(bossName)};`;
  const lines = [...casts]
    .sort((a, b) => a[0] - b[0])
    .map(([t, spellId]) => {
      let ph = 1;
      let at = t;
      if (phases.length > 1) {
        const i = phases.reduce((k, p, n) => (t >= p.from ? n : k), 0);
        ph = phases[i].id ?? i + 1;
        at = t - phases[i].from;
      }
      return `time:${Math.max(0, Math.round(at))};ph:${ph};tag:${clean(tag)};spellid:${spellId};${
        countdown ? `countdown:${countdown};` : ''
      }`;
    });
  return [head, ...lines].join('\n');
};
