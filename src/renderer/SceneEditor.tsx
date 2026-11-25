import React, { Dispatch, SetStateAction, useState } from 'react';
import { AppState, RecStatus, SceneItem } from 'main/types';
import { Phrase } from 'localisation/phrases';
import { getLocalePhrase } from 'localisation/translations';
import RecorderPreview from './RecorderPreview';
import ChatOverlayControls from './ChatOverlayControls';
import VideoSourceControls from './VideoSourceControls';
import AudioSourceControls from './AudioSourceControls';
import VideoBaseControls from './VideoBaseControls';
import { ScrollArea } from './components/ScrollArea/ScrollArea';
import {
  PageHeader,
  TabItem,
  UnderlineTabs,
} from './components/PageHeader/PageHeader';
import { settingsButtonClass } from './components/SettingsCard/SettingsCard';
import { Button } from './components/Button/Button';
import Switch from './components/Switch/Switch';
import { Tooltip } from './components/Tooltip/Tooltip';
import { ConfigurationSchema } from 'config/configSchema';

type SceneTab = 'source' | 'video' | 'audio' | 'overlay';

const ipc = window.electron.ipcRenderer;
const devMode = process.env.NODE_ENV === 'development';

interface IProps {
  appState: AppState;
  recorderStatus: RecStatus;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
  previewEnabled: boolean;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
}

const SceneEditor: React.FC<IProps> = (props: IProps) => {
  const {
    recorderStatus,
    appState,
    config,
    setConfig,
    previewEnabled,
    setPreviewEnabled,
  } = props;
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [tab, setTab] = useState<SceneTab>('source');

  const renderResetGameButton = () => {
    return (
      <Button
        className={settingsButtonClass}
        variant="ghost"
        size="sm"
        onClick={() => ipc.resetSourcePosition(SceneItem.GAME)}
      >
        {getLocalePhrase(appState.language, Phrase.ResetGameButtonText)}
      </Button>
    );
  };

  const renderResetOverlayButton = () => {
    return (
      <Button
        className={settingsButtonClass}
        variant="ghost"
        size="sm"
        onClick={() => {
          setConfig((prev) => ({
            ...prev,
            chatOverlayCropX: 0,
            chatOverlayCropY: 0,
          }));
          ipc.resetSourcePosition(SceneItem.OVERLAY);
        }}
      >
        {getLocalePhrase(appState.language, Phrase.ResetOverlayButtonText)}
      </Button>
    );
  };

  const renderToggleSnappingSwitch = () => {
    return (
      <Tooltip
        content={getLocalePhrase(
          appState.language,
          Phrase.SourceSnappingSwitchTooltip,
        )}
        side="bottom"
      >
        <div className="flex items-center justify-center text-[13px] text-foreground-lighter font-medium gap-x-2">
          {getLocalePhrase(appState.language, Phrase.SourceSnappingSwitchText)}
          <Switch
            checked={snapEnabled}
            onCheckedChange={setSnapEnabled}
            aria-label={getLocalePhrase(
              appState.language,
              Phrase.SourceSnappingSwitchText,
            )}
          />
        </div>
      </Tooltip>
    );
  };

  const renderShowPreviewSwitch = () => {
    // This is a dev mode only thing so don't worry about translations.
    return (
      <Tooltip content="Toggle preview." side="bottom">
        <div className="flex items-center justify-center text-[13px] text-foreground-lighter font-medium gap-x-2">
          Preview
          <Switch
            aria-label="Preview"
            checked={previewEnabled}
            onCheckedChange={setPreviewEnabled}
          />
        </div>
      </Tooltip>
    );
  };

  const waitingForGame = recorderStatus === RecStatus.WaitingForWoW;

  const tabs: TabItem<SceneTab>[] = [
    {
      key: 'source',
      label: getLocalePhrase(appState.language, Phrase.SourceHeading),
    },
    {
      key: 'video',
      label: getLocalePhrase(appState.language, Phrase.VideoHeading),
    },
    {
      key: 'audio',
      label: getLocalePhrase(appState.language, Phrase.AudioHeading),
    },
    {
      key: 'overlay',
      label: getLocalePhrase(appState.language, Phrase.OverlayHeading),
    },
  ];

  return (
    <div className="flex h-full w-full flex-col bg-background-higher pt-[32px]">
      <div className="flex h-full w-full min-h-0 flex-col gap-y-3 px-7 pt-6 pb-4">
        <PageHeader
          title={getLocalePhrase(appState.language, Phrase.SceneButtonText)}
          subtitle={getLocalePhrase(appState.language, Phrase.SceneSubtitle)}
          actions={
            <>
              {renderResetGameButton()}
              {config.chatOverlayEnabled && renderResetOverlayButton()}
              {renderToggleSnappingSwitch()}
              {devMode && renderShowPreviewSwitch()}
            </>
          }
        />

        {/* The OBS preview is drawn by the app over this box, so anything
            that must stay readable sits above or below it, not on it. */}
        <div className="min-h-[140px] flex-[2] overflow-hidden rounded-lg border border-panel-line bg-black">
          <RecorderPreview
            appState={appState}
            previewEnabled={previewEnabled}
            config={config}
            snapEnabled={snapEnabled}
          />
        </div>
        {waitingForGame && (
          <div data-state="empty" className="text-[13px] text-foreground">
            {getLocalePhrase(appState.language, Phrase.SceneWaitingForGame)}
          </div>
        )}

        <div className="flex min-h-0 flex-[3] flex-col gap-y-3">
          <UnderlineTabs<SceneTab>
            items={tabs}
            value={tab}
            onChange={setTab}
            label="Scene settings"
          />
          <ScrollArea
            withScrollIndicators={false}
            className="min-h-0 flex-1 rounded-lg border border-panel-line bg-panel"
          >
            <div>
              {tab === 'source' && <VideoSourceControls appState={appState} />}
              {tab === 'video' && (
                <VideoBaseControls
                  recorderStatus={recorderStatus}
                  appState={appState}
                  setPreviewEnabled={setPreviewEnabled}
                  config={config}
                  setConfig={setConfig}
                />
              )}
              {tab === 'audio' && (
                <AudioSourceControls
                  appState={appState}
                  setPreviewEnabled={setPreviewEnabled}
                />
              )}
              {tab === 'overlay' && (
                <ChatOverlayControls
                  appState={appState}
                  config={config}
                  setConfig={setConfig}
                />
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};

export default SceneEditor;
