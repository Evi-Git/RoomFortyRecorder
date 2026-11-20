/**
 * [RoomFortyRecorder] Logs → Trends: what a night is called. A night in the
 * progression phase is "First kill" only if it holds the kill; the nights of
 * wipes before it are "Progression".
 */
export const nightKind = (n: {
  phase?: 'first' | 'kills';
  kills: number;
}): 'First kill' | 'Progression' | 'Reclear' =>
  n.phase === 'first'
    ? n.kills > 0
      ? 'First kill'
      : 'Progression'
    : 'Reclear';

/** The small heading under a night's date. */
export const nightHeading = (n: {
  phase?: 'first' | 'kills';
  kills: number;
}) =>
  n.phase === 'first'
    ? nightKind(n).toLowerCase()
    : `${n.kills} kill${n.kills > 1 ? 's' : ''}`;
