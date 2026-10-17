import { PropsWithChildren, ReactNode } from 'react';
import { useMenuContext } from './Menu';
import { cn } from '../utils';
import { Badge } from '../Badge/Badge';

type MenuItemProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  className?: string;
  disabled?: boolean;
};

const Root = ({
  value,
  className,
  children,
  disabled = false,
}: PropsWithChildren<MenuItemProps>) => {
  const { currentValue, onValueChange } = useMenuContext();
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
        },
        className,
      )}
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
    <div className="mr-3 w-[18px] h-[18px] flex items-center justify-center opacity-70 group-data-[active=true]:opacity-100 group-data-[active=true]:text-brand">
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
