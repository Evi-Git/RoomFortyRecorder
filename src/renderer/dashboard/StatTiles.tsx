import React from 'react';
import type { Stat } from './stats';

/**
 * [RoomFortyRecorder] A row of stat tiles above the pull's sections. A tile
 * whose stat is null is left out.
 */
/** `loading` keeps the tile's place (a grey block) until its data arrives. */
export type Tile = {
  key: string;
  label: string;
  stat: Stat | null | 'loading';
};

const StatTiles = ({ tiles }: { tiles: Tile[] }) => (
  <div
    className="grid gap-4"
    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}
    data-testid="stat-tiles"
  >
    {tiles.map((tile) => {
      const { stat } = tile;
      if (!stat) return null;
      if (stat === 'loading') {
        return (
          <div
            key={tile.key}
            data-state="loading"
            aria-label={`${tile.label}, loading`}
            className="min-h-[82px] animate-pulse rounded-lg border border-panel-line bg-panel px-4 py-3.5"
          >
            <div className="text-[13px] text-foreground">{tile.label}</div>
          </div>
        );
      }
      return (
        <div
          key={tile.key}
          className="rounded-lg border border-panel-line bg-panel px-4 py-3.5"
        >
          <div className="text-[13px] text-foreground">{tile.label}</div>
          <div className="text-[22px] font-semibold leading-snug tabular-nums text-foreground-lighter">
            {stat.value}
          </div>
          {stat.note ? (
            <div className="text-xs text-foreground">{stat.note}</div>
          ) : null}
        </div>
      );
    })}
  </div>
);

export default StatTiles;
