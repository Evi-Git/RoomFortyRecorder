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
  code: string;
  fight: number;
  casts: [number, number][] | null;
  phases?: [number, number][];
  state: 'ready' | 'queued' | 'failed';
  error?: string;
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
