/**
 * [RoomFortyRecorder] Top logs and Time trial: shared bits.
 */
import React from 'react';
import { specializationById } from 'main/constants';
import { specImages } from '../images';
import { useSpellLabels } from '../logs/SpellIcon';

export const ipc = window.electron.ipcRenderer;
type Response<T> = { ok: true; data: T } | { ok: false; error: string };
export const call = <T,>(request: Record<string, unknown>) =>
  ipc.invoke('pullDesk', [request]) as Promise<Response<T>>;

export type RankRow = {
  rank: number;
  name: string;
  server: string;
  region: string;
  guild: string | null;
  amount: number;
  duration: number;
  ilvl: number | null;
  /** When the fight was (ms since 1970); 0 or missing when Warcraft Logs didn't say. */
  startTime?: number;
  code: string;
  fight: number;
  casts: [number, number][] | null;
  phases?: [number, number][];
  /**
   * ready: casts are in. queued: waiting its turn or being fetched
   * (`attempt` above 1: a second or third try). waiting: paused by
   * Warcraft Logs' hourly limit until `resumesAt` (1.9.169 servers).
   * failed: `error` says why; Retry asks again.
   */
  state: 'ready' | 'queued' | 'waiting' | 'failed';
  error?: string;
  attempt?: number;
  resumesAt?: number;
};

export type SpecInfo = {
  label: string;
  name: string;
  class: string;
  role: string;
};
export const spec = (id: number) =>
  (specializationById as Record<number, SpecInfo>)[id] as SpecInfo | undefined;
export const specTitle = (id: number) => {
  const s = spec(id);
  return s ? `${s.name} ${s.label}` : `Spec ${id}`;
};
export const SpecImage = ({ id, size = 20 }: { id: number; size?: number }) => {
  const src = (specImages as Record<number, string>)[id];
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="rounded-sm shrink-0"
      draggable={false}
    />
  ) : (
    <span
      className="rounded-sm bg-card shrink-0"
      style={{ width: size, height: size }}
    />
  );
};

/** Ticks for a time axis: every 30 s up to 4 min, then every minute. */
export const ticks = (max: number) => {
  const step = max > 240 ? 60 : 30;
  const out: number[] = [];
  for (let t = step; t < max; t += step) out.push(t);
  return out;
};

/**
 * Spell names (Warcraft Logs' names, as they arrive) as a fresh object each
 * render. The labels live in a module-level Map that the React Compiler
 * would treat as unchanged, so this hook opts out of memoizing.
 */
export const useSpellNames = (ids: number[]): Record<number, string> => {
  'use no memo';

  const labels = useSpellLabels(ids);
  const out: Record<number, string> = {};
  ids.forEach((id) => {
    const name = labels.get(id);
    if (name) out[id] = name;
  });
  return out;
};
