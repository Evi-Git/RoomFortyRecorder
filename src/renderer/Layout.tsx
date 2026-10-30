import * as React from 'react';
import {
  CombatLoggingStatus,
  Pages,
  RecStatus,
  AppState,
  RendererVideo,
  InstantReplayState,
} from 'main/types';
import { Dispatch, RefObject, SetStateAction } from 'react';
import { ConfigurationSchema } from 'config/configSchema';
import SceneEditor from './SceneEditor';
import SettingsPage from './SettingsPage';
import CategoryPage from './CategoryPage';
import InstantReplay from './InstantReplay';
import LivePage from './LivePage';
import AdminPage from './AdminPage';
import { LogsPage } from './Meters';
import TopLogsPage from './toplogs/TopLogsPage';
import PullDeskPage from './PullDeskPage';

interface IProps {
  recorderStatus: RecStatus;
  videoState: RendererVideo[];
  setVideoState: Dispatch<SetStateAction<RendererVideo[]>>;
  appState: AppState;
  setAppState: Dispatch<SetStateAction<AppState>>;
  persistentProgressRef: RefObject<number>;
  playerHeightRef: RefObject<number>;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
  combatLoggingStatus: CombatLoggingStatus;
  previewEnabled: boolean;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
  instantReplayState: InstantReplayState;
  setInstantReplayState: Dispatch<SetStateAction<InstantReplayState>>;
  /** [RoomFortyRecorder] This tab is showing (see tabs/tabs.ts). */
  active?: boolean;
  /** Bumped when Watch reuses this tab, so the recording reloads. */
  revision?: number;
}

/**
 * The main window, minus the top and bottom bars.
 */
const Layout = (props: IProps) => {
  const {
    recorderStatus,
    videoState,
    setVideoState,
    appState,
    setAppState,
    persistentProgressRef,
    playerHeightRef,
    config,
    setConfig,
    combatLoggingStatus,
    previewEnabled,
    setPreviewEnabled,
    instantReplayState,
    setInstantReplayState,
    active = true,
    revision = 0,
  } = props;
  const { page, category } = appState;
  // Settings, Scene, Instant replay, Watch live and Admin hold one-of-a-kind
  // things (the OBS preview, the live connection), so they unmount while
  // their tab is hidden. Recordings, Logs and Dashboard stay mounted.
  const shown = (p: Pages) => page === p && active;

  const renderCategoryPage = () => {
    return (
      <CategoryPage
        key={`${category}-${revision}`}
        category={category}
        videoState={videoState}
        setVideoState={setVideoState}
        appState={appState}
        setAppState={setAppState}
        persistentProgressRef={persistentProgressRef}
        playerHeightRef={playerHeightRef}
      />
    );
  };

  const renderSettingsPage = () => {
    return (
      <SettingsPage
        recorderStatus={recorderStatus}
        config={config}
        setConfig={setConfig}
        appState={appState}
        setAppState={setAppState}
        combatLoggingStatus={combatLoggingStatus}
        videoState={videoState}
      />
    );
  };

  const renderSceneEditor = () => {
    return (
      <SceneEditor
        recorderStatus={recorderStatus}
        appState={appState}
        config={config}
        setConfig={setConfig}
        previewEnabled={previewEnabled}
        setPreviewEnabled={setPreviewEnabled}
      />
    );
  };

  const renderInstantReplay = () => {
    return (
      <InstantReplay
        instantReplayState={instantReplayState}
        setInstantReplayState={setInstantReplayState}
        appState={appState}
        setAppState={setAppState}
        persistentProgressRef={persistentProgressRef}
        config={config}
      />
    );
  };

  return (
    <>
      {shown(Pages.Settings) && renderSettingsPage()}
      {shown(Pages.SceneEditor) && renderSceneEditor()}
      {shown(Pages.InstantReplay) && renderInstantReplay()}
      {shown(Pages.Live) && <LivePage />}
      {shown(Pages.Admin) && <AdminPage />}
      {page === Pages.Logs && (
        <LogsPage
          videoState={videoState}
          setAppState={setAppState}
          persistentProgressRef={persistentProgressRef}
        />
      )}
      {page === Pages.TopLogs && <TopLogsPage />}
      {page === Pages.PullDesk && (
        <PullDeskPage
          videoState={videoState}
          setAppState={setAppState}
          persistentProgressRef={persistentProgressRef}
        />
      )}
      {page === Pages.None && renderCategoryPage()}
    </>
  );
};

export default Layout;
