import React from 'react';
import { initials, spellColor } from './timelineUtils';

const ICON_CDN = 'https://wow.zamimg.com/images/wow/icons/large';

/** A spell's icon, or a coloured tile with its initials if there's none. */
const SpellIcon = ({
  spellId,
  name,
  icon,
  size,
  className = '',
}: {
  spellId: number;
  name: string;
  icon?: string;
  size: number;
  className?: string;
}) => {
  const [failed, setFailed] = React.useState(false);

  if (icon && !failed) {
    return (
      <img
        src={`${ICON_CDN}/${icon}.jpg`}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className={`rounded-[3px] shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`rounded-[3px] shrink-0 inline-block text-center font-bold text-black/80 ${className}`}
      style={{
        width: size,
        height: size,
        lineHeight: `${size}px`,
        fontSize: Math.max(7, Math.round(size * 0.45)),
        background: spellColor(spellId),
      }}
    >
      {size >= 12 ? initials(name) : ''}
    </span>
  );
};

export default SpellIcon;
