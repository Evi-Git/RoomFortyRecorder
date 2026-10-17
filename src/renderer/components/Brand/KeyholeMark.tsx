/**
 * [RoomFortyRecorder] The Room Forty mark: a 4 and a keyhole (the 0 of 40).
 * Drawn in currentColor; source in assets/brand/keyhole-40.svg.
 */
const KeyholeMark = ({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="currentColor"
    className={className}
    role="img"
    aria-label="Room Forty"
  >
    <g transform="translate(1.1 -1.5)">
      <path d="M21.28 47.65L5.85 47.65L5.85 41.72L19 20.99L28.56 20.99L28.56 41.66L32.41 41.66L32.41 47.65L28.56 47.65L28.56 53L21.28 53L21.28 47.65ZM13.39 41.66L21.45 41.66L21.45 29.07L21.19 29.07L13.39 41.40Z" />
      <circle cx="46" cy="24" r="10" />
      <polygon points="40,29 52,29 56,53 36,53" />
    </g>
  </svg>
);

export default KeyholeMark;
