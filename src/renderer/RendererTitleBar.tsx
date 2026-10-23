import { ComponentProps } from 'react';
import { cn } from './components/utils';
import KeyholeMark from './components/Brand/KeyholeMark';

const ipc = window.electron.ipcRenderer;

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

  return (
    <div
      id="title-bar"
      className="w-full h-[32px] bg-background flex items-center justify-start px-4 pr-0 absolute top-0 left-0"
    >
      {/* [RoomFortyRecorder] Lockup sits over the sidebar, left aligned. */}
      <KeyholeMark size={18} className="text-brand mr-2" />
      <div className="text-sm">
        <span className="font-display font-semibold text-foreground-lighter">
          Bellhop
        </span>{' '}
        <span className="font-sans text-foreground">· Room Forty</span>
      </div>
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
