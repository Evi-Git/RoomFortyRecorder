/**
 * Capabilities that only work together with another one: the same table as
 * `IMPLIES` in guild-cloud-server/permissions.mjs, which is what the server
 * enforces (permissions.test.mjs checks the two stay equal, so keep one
 * `key: ['needed', ...],` pair per line).
 */
export const CAPABILITY_NEEDS: Record<string, string[]> = {
  analysisEdit: ['analysisView'],
  watcherManage: ['analysisView'],
};

/**
 * The capabilities `key` needs that `role` lacks, given each capability's
 * list of granted roles (`everyone` counts for every role).
 */
export const missingNeeds = (
  key: string,
  role: string,
  grants: Record<string, string[]>,
  everyone: string,
): string[] =>
  (CAPABILITY_NEEDS[key] ?? []).filter((needed) => {
    const list = grants[needed] ?? [];
    return !list.includes(role) && !list.includes(everyone);
  });
