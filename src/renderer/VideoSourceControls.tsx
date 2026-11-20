import { useEffect, useRef, useState } from 'react';
import { AppState, OurDisplayType } from 'main/types';
import { configSchema } from 'config/configSchema';
import { getLocalePhrase } from 'localisation/translations';
import { useSettings, setConfigValues } from './useSettings';
import Switch from './components/Switch/Switch';
import { Segmented } from './logs/Segmented';
import {
  SettingRow,
  useScopedIds,
} from './components/SettingsCard/SettingsCard';
import { Phrase } from 'localisation/phrases';

const ipc = window.electron.ipcRenderer;

interface IProps {
  appState: AppState;
}

const VideoSourceControls = (props: IProps) => {
  const { appState } = props;
  const [config, setConfig] = useSettings();
  const [displays, setDisplays] = useState<OurDisplayType[]>([]);
  const initialRender = useRef(true);

  useEffect(() => {
    const getDisplays = async () => {
      const allDisplays = await ipc.invoke('getAllDisplays', []);
      setDisplays(allDisplays);
    };

    getDisplays();

    // The reset of this effect handles config changes, so if it's the
    // initial render then just return here.
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    setConfigValues({
      obsCaptureMode: config.obsCaptureMode,
      monitorIndex: config.monitorIndex,
      captureCursor: config.captureCursor,
      forceSdr: config.forceSdr,
    });

    ipc.reconfigureVideo();
  }, [
    config.monitorIndex,
    config.obsCaptureMode,
    config.captureCursor,
    config.forceSdr,
  ]);

  const setOBSCaptureMode = (mode: string) => {
    if (!mode) {
      // Covers empty string or anything nullish.
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        obsCaptureMode: mode,
      };
    });
  };

  const setMonitor = (display: string) => {
    // Display is a string at this point so "0" is still truthy.
    if (!display) {
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        monitorIndex: parseInt(display, 10),
      };
    });
  };

  const setCaptureCursor = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        captureCursor: checked,
      };
    });
  };

  const { language } = appState;
  const sid = useScopedIds();

  const getCaptureModeToggle = () => {
    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.CaptureModeLabel)}
        help={getLocalePhrase(
          language,
          configSchema.obsCaptureMode.description,
        )}
      >
        <Segmented
          label={getLocalePhrase(language, Phrase.CaptureModeLabel)}
          tall
          value={config.obsCaptureMode}
          onChange={setOBSCaptureMode}
          items={[
            {
              key: 'window_capture',
              label: getLocalePhrase(language, Phrase.WindowCaptureValue),
            },
            {
              key: 'game_capture',
              label: getLocalePhrase(language, Phrase.GameCaptureValue),
            },
            {
              key: 'monitor_capture',
              label: getLocalePhrase(language, Phrase.MonitorCaptureValue),
            },
          ]}
        />
      </SettingRow>
    );
  };

  const getMonitorToggle = () => {
    if (config.obsCaptureMode !== 'monitor_capture') {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.MonitorLabel)}
        help={getLocalePhrase(language, configSchema.monitorIndex.description)}
      >
        <Segmented
          label={getLocalePhrase(language, Phrase.MonitorLabel)}
          tall
          value={config.monitorIndex.toString()}
          onChange={setMonitor}
          items={displays.map((display: OurDisplayType) => ({
            key: display.index.toString(),
            label: display.index + 1,
          }))}
        />
      </SettingRow>
    );
  };

  const getCursorToggle = () => {
    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.CaptureCursorLabel)}
        help={getLocalePhrase(language, configSchema.captureCursor.description)}
        htmlFor={sid('cursor')}
      >
        <Switch
          id={sid('cursor')}
          checked={config.captureCursor}
          onCheckedChange={setCaptureCursor}
        />
      </SettingRow>
    );
  };

  const setForceSdr = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        forceSdr: checked,
      };
    });
  };

  const getForceSdrToggle = () => {
    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.ForceSdrLabel)}
        help={getLocalePhrase(language, configSchema.forceSdr.description)}
        htmlFor={sid('sdr')}
      >
        <Switch
          id={sid('sdr')}
          checked={config.forceSdr}
          onCheckedChange={setForceSdr}
        />
      </SettingRow>
    );
  };

  return (
    <div className="divide-y divide-panel-line">
      {getCaptureModeToggle()}
      {getMonitorToggle()}
      {getCursorToggle()}
      {getForceSdrToggle()}
    </div>
  );
};

export default VideoSourceControls;
