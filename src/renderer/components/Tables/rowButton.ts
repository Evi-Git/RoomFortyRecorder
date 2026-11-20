/**
 * [RoomFortyRecorder] Design A: the small icon buttons at the ends of a table
 * row (protect, tag, clip source...): muted, 15 px icons, 6 px padding.
 */
export const ROW_ICON_SIZE = 15;

export const rowButtonClass = (active = false) =>
  `h-7 w-7 p-1.5 rounded-md hover:bg-panel-raised ${
    active
      ? 'text-brand hover:text-brand'
      : 'text-foreground hover:text-foreground-lighter'
  }`;
