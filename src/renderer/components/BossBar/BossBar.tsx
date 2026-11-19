import React from 'react';
import { cn } from '../utils';

/**
 * [RoomFortyRecorder] How far a pull got: a thin bar that fills as the boss
 * loses health (a 38% wipe fills 62%), green and full on a kill. Used by the
 * Logs and Dashboard pull lists so both read the same way.
 */
const BossBar = ({
  bossPercent,
  kill,
  className,
}: {
  /** Boss health left at the end, 0–100; null when unknown. */
  bossPercent: number | null | undefined;
  kill: boolean;
  className?: string;
}) => {
  const known = kill || typeof bossPercent === 'number';
  const done = kill
    ? 100
    : Math.max(0, Math.min(100, 100 - (bossPercent ?? 100)));
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-block h-1 rounded-full bg-panel-line overflow-hidden',
        className,
      )}
    >
      {known && (
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            kill ? 'bg-green-400' : 'bg-foreground-lighter/70',
          )}
          style={{ width: `${done}%` }}
        />
      )}
    </span>
  );
};

export default BossBar;
