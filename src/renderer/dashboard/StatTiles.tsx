import React from 'react';
import type { Stat } from './stats';

/**
 * [RoomFortyRecorder] A row of stat tiles above the pull's sections. A tile
 * whose stat is null is left out.
 */
export type Tile = { key: string; label: string; stat: Stat | null };

const StatTiles = ({ tiles }: { tiles: Tile[] }) => (
  <div className="flex flex-wrap gap-4" data-testid="stat-tiles">
    {tiles
      .filter((tile) => tile.stat)
      .map((tile) => (
        <div
          key={tile.key}
          className="min-w-[200px] flex-1 rounded-lg border border-panel-line bg-panel px-4 py-3.5"
        >
          <div className="text-[13px] text-foreground">{tile.label}</div>
          <div className="text-[22px] font-semibold leading-snug tabular-nums text-foreground-lighter">
            {tile.stat?.value}
          </div>
          {tile.stat?.note ? (
            <div className="text-xs text-foreground">{tile.stat.note}</div>
          ) : null}
        </div>
      ))}
  </div>
);

export default StatTiles;
