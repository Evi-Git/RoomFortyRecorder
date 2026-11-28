/**
 * A button whose tooltip turns into the reason it is disabled ("You don't
 * have permission...") must still be named for what it does. `name` is the
 * action (always the accessible name); `tooltip` is what the tooltip shows.
 * When they differ, the tooltip is a reason, and it is exposed through
 * aria-describedby on a hidden span (see DisabledReason), not as the name.
 */
export const nameAndReason = (
  name: string,
  tooltip: string,
  reasonId: string,
): { 'aria-label': string; 'aria-describedby'?: string } =>
  tooltip && tooltip !== name
    ? { 'aria-label': name, 'aria-describedby': reasonId }
    : { 'aria-label': name };

/** The reason text to render for nameAndReason, or null when there is none. */
export const reasonText = (name: string, tooltip: string): string | null =>
  tooltip && tooltip !== name ? tooltip : null;
