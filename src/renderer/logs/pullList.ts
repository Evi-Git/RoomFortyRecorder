import { isReset } from '../resets';

/**
 * [RoomFortyRecorder] The Logs page's pull list (design A): which pulls to
 * show with resets hidden, and where an "Open in Logs" target lands. Pure,
 * tested in src/__tests__/renderer/pullList.test.ts.
 */

type ListPull = { id: string; duration?: number | null };

/**
 * The pulls to list. Resets are left out unless `showResets` is on, except
 * a pull that is picked or being looked at (it is never hidden). When every
 * pull is a reset they are all shown, so the list is never empty.
 */
export const visiblePulls = <P extends ListPull>(
  pulls: P[],
  showResets: boolean,
  keepIds: string[],
): P[] => {
  if (showResets) return pulls;
  const kept = pulls.filter((p) => !isReset(p) || keepIds.includes(p.id));
  return kept.length ? kept : pulls;
};

/** True when every pull is a reset, so none can be hidden. */
export const allResets = (pulls: ListPull[]) =>
  pulls.length > 0 && pulls.every((p) => isReset(p));

/** Resets left out of the list (for "Show resets (3)"). */
export const hiddenResets = (all: ListPull[], shown: ListPull[]) =>
  all.length - shown.length;

type TargetBoss<P extends ListPull> = {
  encounterId: number;
  difficultyId: number;
  pullsList: P[];
};

/** The boss key (`encounter:difficulty`) holding a pull of the night, if any. */
export const findTargetPull = <P extends ListPull>(
  bosses: TargetBoss<P>[],
  pullId: string,
): { bossKey: string; pullId: string } | null => {
  const boss = bosses.find((b) => b.pullsList.some((p) => p.id === pullId));
  return boss
    ? { bossKey: `${boss.encounterId}:${boss.difficultyId}`, pullId }
    : null;
};
