import { PropsWithChildren, ReactNode } from 'react';
import { useContext } from 'react';
import { SidebarRailContext, useMenuContext } from './Menu';
import { cn } from '../utils';
import { Badge } from '../Badge/Badge';

type MenuItemProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  className?: string;
  disabled?: boolean;
  /** Shown on hover when the sidebar is an icon strip. */
  label?: string;
};

const Root = ({
  value,
  className,
  children,
  disabled = false,
  label,
}: PropsWithChildren<MenuItemProps>) => {
  const { currentValue, onValueChange } = useMenuContext();
  const rail = useContext(SidebarRailContext);
  const active = currentValue === value && !disabled;
  // [RoomFortyRecorder] Brass sidebar: compact rows, the selected one a
  // filled pill with its icon in brass.
  return (
    <div
      className={cn(
        'group w-full flex flex-row bg-transparent rounded-md px-3 py-2 items-center transition-colors',
        'text-foreground-lighter/80 text-sm font-sans',
        {
          'hover:bg-card/50 hover:text-foreground-lighter':
            !active && !disabled,
          'bg-card text-foreground-lighter font-semibold': active,
          'opacity-50 cursor-not-allowed': disabled,
          // Icon strip: only the icon shows (text is sized away).
          'justify-center px-0 text-[0px] [&_*]:text-[0px] [&_button]:hidden [&_span]:!w-auto [&_.ml-auto]:hidden':
            rail,
        },
        className,
      )}
      title={rail ? label : undefined}
      data-rail={rail}
      data-active={active}
      onClick={disabled ? undefined : () => onValueChange(value)}
      role="button"
    >
      {children}
    </div>
  );
};

const Icon = ({ children }: { children: ReactNode }) => {
  return (
    <div className="mr-3 group-data-[rail=true]:mr-0 w-[18px] h-[18px] shrink-0 flex items-center justify-center opacity-70 group-data-[active=true]:opacity-100 group-data-[active=true]:text-brand">
      {children}
    </div>
  );
};

type MenuBadgeProps = {
  value?: number;
};

const MenuBadge = ({ value }: MenuBadgeProps) => {
  return value ? (
    <Badge variant="default" className="ml-auto">
      {value <= 99999 ? value : '99999+'}
    </Badge>
  ) : null;
};

const Item = Object.assign(Root, { Icon, Badge: MenuBadge });

export default Item;
