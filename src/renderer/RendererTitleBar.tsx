import React, { ComponentProps } from 'react';
import { cn } from './components/utils';
import KeyholeMark from './components/Brand/KeyholeMark';
import { setViewAs, usePermissions } from './usePermissions';

const ipc = window.electron.ipcRenderer;

const TitleBarButton = ({
  children,
  className,
  ...props
}: ComponentProps<'button'>) => {
  return (
    <button
      type="button"
      className={cn(
        'w-8 h-8 bg-transparent border-0 text-white text-base outline-none hover:bg-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
};

// [RoomFortyRecorder] The owner's "view as role" banner (Admin page).
const ViewAsBanner = () => {
  const permissions = usePermissions();
  if (!permissions?.viewAs) return null;
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 top-[4px] flex items-center gap-x-2 rounded-full bg-brand px-3 h-[24px] text-xs font-semibold text-background"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      Viewing as{' '}
      {permissions.viewAs === '@everyone' ? 'Everyone' : permissions.viewAs}
      <button
        type="button"
        onClick={() => setViewAs(null)}
        className="underline underline-offset-2"
      >
        Exit
      </button>
    </div>
  );
};

export default function RendererTitleBar() {
  const clickedHide = () => {
    ipc.sendMessage('window', ['minimize']);
  };

  const clickedResize = () => {
    ipc.sendMessage('window', ['resize']);
  };

  const clickedQuit = () => {
    ipc.sendMessage('window', ['quit']);
  };

  return (
    <div
      id="title-bar"
      className="w-full h-[32px] bg-background flex items-center justify-start px-4 pr-0 absolute top-0 left-0"
    >
      {/* [RoomFortyRecorder] Lockup sits over the sidebar, left aligned. */}
      <KeyholeMark size={18} className="text-brand mr-2" />
      <div className="text-sm">
        <span className="font-display font-semibold text-foreground-lighter">
          Room Forty
        </span>{' '}
        <span className="font-sans text-foreground">Toolkit</span>
      </div>
      <ViewAsBanner />
      <div id="title-bar-btns" className="ml-auto absolute right-0 top-0">
        <TitleBarButton id="min-btn" onClick={clickedHide}>
          🗕
        </TitleBarButton>
        <TitleBarButton id="max-btn" onClick={clickedResize}>
          🗗
        </TitleBarButton>
        <TitleBarButton
          id="close-btn"
          className="hover:bg-destructive"
          onClick={clickedQuit}
        >
          ✖
        </TitleBarButton>
      </div>
    </div>
  );
}
