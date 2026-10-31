/**
 * [RoomFortyRecorder] Top logs and Time trial (1.9.96): the math, kept
 * pure for tests (src/__tests__/renderer/topLogsTrial.test.ts).
 *
 * A "track" is one player in one fight: cumulative damage (or healing)
 * second by second, and their casts as [seconds, spell ID]. Top players'
 * tracks come from Warcraft Logs via the guild server; ours from our own
 * full combat log, counted the way the Logs page counts.
 */
import { castRows, DEFAULT_FILTERS, makeCtx, meterRows } from '../logs/query';
import type { PullStore } from '../logs/store';

export type Track = {
  name: string;
  duration: number;
  /** Cumulative amount at the end of each second. */
  amounts: number[];
  casts: [number, number][];
  phases?: [number, number][];
  phaseNames?: Record<string, string>;
  /** Spell ID -> name (1.9.102 server; ours from our log). */
  names?: Record<number, string>;
  /** Their fight's enemy casts as [seconds, spell ID] (1.9.102 server). */
  enemy?: [number, number][];
};

export type Cooldown = {
  spellId: number;
  /** Every ID of this name (1.9.102 server merges by name). */
  spellIds?: number[];
  name?: string;
  share: number;
  medianGap: number;
  medianCasts: number;
  medianFirst: number;
  cooldown: number | null;
};

/** Raiders in a pull (players in COMBATANT_INFO), by name. */
export const raidersOf = (store: PullStore) =>
  store.units
    .map((u, i) => ({ ...u, index: i }))
    .filter((u) => u.player && u.raider && u.root === u.index && u.name)
    .map((u) => ({ name: u.name, guid: u.guid, specId: u.specId }))
    .sort((a, b) => a.name.localeCompare(b.name));

/** One raider's track from our own log (same rules as the Logs page). */
export const ourTrack = (
  store: PullStore,
  guid: string,
  metric: 'dps' | 'hps',
): Track | null => {
  const ctx = makeCtx([store], DEFAULT_FILTERS);
  const row = meterRows(ctx, metric === 'hps' ? 'healing' : 'damage').find(
    (r) => r.key === guid,
  );
  const unit = store.units.find((u) => u.guid === guid);
  if (!unit) return null;
  const seconds = Math.max(1, Math.ceil(store.duration));
  const amounts: number[] = [];
  let sum = 0;
  for (let i = 0; i < seconds; i += 1) {
    sum += row?.series[i] ?? 0;
    amounts.push(Math.round(sum));
  }
  const casts: [number, number][] = [];
  const names: Record<number, string> = {};
  castRows(ctx)
    .find((r) => r.key === guid)
    ?.spells.forEach((s) => {
      names[s.spellId] = s.name;
      s.times.forEach((t) => casts.push([Math.round(t * 10) / 10, s.spellId]));
    });
  casts.sort((a, b) => a[0] - b[0]);
  return { name: unit.name, duration: store.duration, amounts, casts, names };
};

/** Amount at a time (seconds), holding the last value past the end. */
export const amountAt = (track: Track, t: number) => {
  if (!track.amounts.length || t <= 0) return 0;
  const i = Math.min(track.amounts.length - 1, Math.floor(t) - 1);
  return i < 0 ? 0 : track.amounts[i];
};

/** You minus them, second by second, over the shorter fight. */
export const gapSeries = (you: Track, them: Track) => {
  const n = Math.min(you.amounts.length, them.amounts.length);
  return Array.from({ length: n }, (_, i) => you.amounts[i] - them.amounts[i]);
};

/** Per-second rate over the whole fight. */
export const rate = (track: Track) =>
  track.duration > 0
    ? (track.amounts[track.amounts.length - 1] ?? 0) / track.duration
    : 0;

/** The Warcraft Logs link for a ranked kill. */
export const wclUrl = (code: string, fight: number, metric: 'dps' | 'hps') =>
  `https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}#fight=${fight}&type=${
    metric === 'hps' ? 'healing' : 'damage-done'
  }`;

/** The VoD button's label and tooltip, from whose recording would open. */
export const vodInfo = (owner: string | null, raider: string) => {
  if (owner === null) {
    return {
      owner,
      label: 'Our VoD',
      tip: 'No recording of this pull, on this PC or in the guild cloud.',
    };
  }
  const theirs = !owner || owner === raider;
  return {
    owner,
    label: theirs && raider ? `Watch ${raider}'s VoD` : 'Watch our VoD',
    tip: theirs
      ? 'Opens the recording of this pull. Click the race chart to start at that moment.'
      : `${raider || 'This raider'} has no recording of this pull; opens ${owner}'s. Click the race chart to start at that moment.`,
  };
};
