import React from 'react';

/**
 * [RoomFortyRecorder] Logs page zoom: with a slice picked, charts, lanes and
 * uptime bars show only the slice, stretched across their full width (as
 * Warcraft Logs does), unless zoomed out to see the slice within the fight.
 */
export const ZoomContext = React.createContext<{
  zoomed: boolean;
  setZoomed: (z: boolean) => void;
}>({ zoomed: true, setZoomed: () => {} });

/** The seconds drawn: the slice when zoomed in, else the whole fight. */
export const useViewWindow = (
  range: [number, number] | null,
  total: number,
): [number, number] => {
  const { zoomed } = React.useContext(ZoomContext);
  return zoomed && range
    ? [range[0], Math.max(range[0] + 0.5, range[1])]
    : [0, Math.max(1, total)];
};
