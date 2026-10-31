/**
 * [RoomFortyRecorder] Ghost on your VoD (1.9.107): when the Time trial opens
 * our recording, the top player rides along as a ghost (a card over the
 * video and their cooldowns over ours under it), following the playhead.
 *
 * The Time trial registers the race here for the pull it opens; the video
 * player looks it up by the recording's boss, difficulty and start. Kept
 * in memory for this run of the app. The pure parts are tested in
 * ghost.test.ts.
 */
import React from 'react';
import type { Track } from './trial';
import {
  Aligned,
  castsFor,
  gapSoFar,
  MainCd,
  perSecond,
  Phase,
  smooth,
} from './timeline';

export type Ghost = {
  encounterId: number;
  difficultyId: number;
  /** The pull's start, as the recordings' start (ms since 1970). */
  startedAt: number;
  rank: number;
  them: Track;
  you: Track;
  aligned: Aligned;
  cooldowns: MainCd[];
  /** Our boss phases (the VoD side shows only ours). */
  phases: Phase[];
  unit: string;
  hidden?: boolean;
};

/** A recording of the pull starts within 2 minutes of it (as Meters). */
const MATCH_MS = 2 * 60 * 1000;
let ghosts: Ghost[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The race for a pull; the newest one for that pull wins. */
export const setGhost = (ghost: Ghost) => {
  ghosts = [
    ghost,
    ...ghosts.filter(
      (g) =>
        !(
          g.encounterId === ghost.encounterId &&
          g.difficultyId === ghost.difficultyId &&
          g.startedAt === ghost.startedAt
        ),
    ),
  ].slice(0, 10);
  emit();
};

export const hideGhost = (ghost: Ghost, hidden: boolean) => {
  ghosts = ghosts.map((g) => (g === ghost ? { ...g, hidden } : g));
  emit();
};

/** The ghost for a recording (its boss, difficulty and start). */
export const ghostFor = (
  list: Ghost[],
  encounterId?: number,
  difficultyId?: number,
  start?: number,
) => {
  if (!encounterId || typeof start !== 'number') return undefined;
  return list.find(
    (g) =>
      g.encounterId === encounterId &&
      g.difficultyId === difficultyId &&
      Math.abs(g.startedAt - start) < MATCH_MS,
  );
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useGhosts = () =>
  React.useSyncExternalStore(subscribe, () => ghosts);

/** Where the race stands at a second of our pull. */
export const ghostAt = (g: Ghost, t: number) => {
  const youRates = perSecond(g.you);
  const gap = gapSoFar(youRates, g.aligned.rates);
  const i = Math.max(0, Math.min(Math.floor(t) - 1, gap.length - 1));
  const youS = smooth(youRates);
  const themS = smooth(g.aligned.rates);
  const phase = g.phases.find((p) => t >= p.from && t < p.to);
  return {
    gap: gap[i] ?? 0,
    you: youS[Math.min(i, youS.length - 1)] ?? 0,
    them: themS[Math.min(i, themS.length - 1)] ?? null,
    phase,
  };
};

export type ComingUp = {
  cd: MainCd;
  /** Seconds until they press it. */
  them: number;
  /** Seconds until ours is ready (0: ready), null if unknown. */
  yours: number | null;
};

/**
 * Their next presses within `ahead` seconds, soonest first, with when ours
 * is ready: our last press plus the cooldown (ready if never pressed).
 */
export const comingUp = (g: Ghost, t: number, ahead = 30, max = 3) => {
  const themSide = { casts: g.aligned.casts, names: g.them.names };
  const out: ComingUp[] = [];
  g.cooldowns.forEach((cd) => {
    const next = castsFor(themSide, cd).find((c) => c >= t);
    if (next === undefined || next - t > ahead) return;
    const mine = castsFor(g.you, cd).filter((c) => c <= t);
    const last = mine[mine.length - 1];
    let yours: number | null = 0;
    if (last !== undefined) {
      if (cd.cooldown) yours = Math.max(0, last + cd.cooldown - t);
      else yours = null;
    }
    out.push({ cd, them: next - t, yours });
  });
  return out.sort((a, b) => a.them - b.them).slice(0, max);
};
