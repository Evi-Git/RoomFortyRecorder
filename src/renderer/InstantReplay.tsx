import { AppState, InstantReplayState } from 'main/types';
import VideoPlayer from './VideoPlayer';
import { Dispatch, RefObject, SetStateAction, useEffect } from 'react';
import { ConfigurationSchema } from 'config/configSchema';
import { Button } from './components/Button/Button';
import { ArrowRight } from 'lucide-react';
import { Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import { PageHeader } from './components/PageHeader/PageHeader';
import { EmptyState } from './components/States/States';

const ipc = window.electron.ipcRenderer;

interface IProps {
  instantReplayState: InstantReplayState;
  setInstantReplayState: Dispatch<SetStateAction<InstantReplayState>>;
  appState: AppState;
  setAppState: Dispatch<SetStateAction<AppState>>;
  persistentProgressRef: RefObject<number>;
  config: ConfigurationSchema;
}

const InstantReplay = (props: IProps) => {
  const {
    instantReplayState,
    setInstantReplayState,
    appState,
    setAppState,
    persistentProgressRef,
    config,
  } = props;

  const { language } = appState;
  const { current, open } = instantReplayState;

  useEffect(() => {
    if (open) {
      ipc.setOpenInstantReplayFile(open.path);
    }

    return () => {
      ipc.setOpenInstantReplayFile(null);
    };
  }, [open]);

  const goToLatestInstantReplay = () => {
    setInstantReplayState((prev) => ({
      ...prev,
      open: prev.current,
    }));
  };

  const renderStaleReplayNotification = () => {
    return (
      <div className="fixed bottom-16 right-2 w-[320px] bg-panel border border-panel-line px-4 py-2 rounded-lg shadow-lg flex items-center ">
        <p className="text-xs text-foreground-lighter">
          {getLocalePhrase(language, Phrase.InstantReplayStale)}
        </p>
        <Button size="sm" onClick={goToLatestInstantReplay}>
          <ArrowRight size={18} />
        </Button>
      </div>
    );
  };

  const header = (
    <PageHeader
      title={getLocalePhrase(language, Phrase.InstantReplayLabel)}
      subtitle={getLocalePhrase(language, Phrase.InstantReplaySubtitle)}
      className="mx-7 mt-6 shrink-0"
    />
  );

  if (!open) {
    return (
      <div className="flex h-full w-full flex-col bg-background-higher pt-[32px]">
        {header}
        <div className="mx-7 mt-5 rounded-lg border border-panel-line bg-panel px-[18px] py-6">
          <EmptyState>
            {getLocalePhrase(language, Phrase.InstantReplayDisabled)} When WoW
            is recording, the latest clip from the buffer shows up here.
          </EmptyState>
        </div>
      </div>
    );
  }

  const replayIsStale = current && open.path !== current.path;

  return (
    <div className="flex h-full w-full flex-col bg-background-higher pt-[32px]">
      {header}
      <div className="flex min-h-0 flex-1">
        <VideoPlayer
          key={open.path}
          videos={[]}
          instantReplay={open}
          categoryState={[]}
          persistentProgressRef={persistentProgressRef}
          config={config}
          appState={appState}
          setAppState={setAppState}
        />
      </div>
      {replayIsStale && renderStaleReplayNotification()}
    </div>
  );
};

export default InstantReplay;
