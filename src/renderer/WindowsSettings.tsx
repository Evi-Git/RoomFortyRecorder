import * as React from 'react';
import { ConfigurationSchema } from 'config/configSchema';
import { AppState } from 'main/types';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValues } from './useSettings';
import Switch from './components/Switch/Switch';
import { Dispatch, SetStateAction, useEffect, useRef } from 'react';
import { Phrase } from 'localisation/phrases';
import {
  SettingRow,
  useScopedIds,
  SettingsSection,
} from './components/SettingsCard/SettingsCard';

const ipc = window.electron.ipcRenderer;

interface IProps {
  appState: AppState;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
}

const WindowsSettings = (props: IProps) => {
  const sid = useScopedIds();
  const { appState, config, setConfig } = props;

  const effect1 = useRef(false);
  const effect2 = useRef(false);

  useEffect(() => {
    // Don't fire on the initial render.
    if (!effect1.current) {
      effect1.current = true;
      return;
    }

    setConfigValues({
      startUp: config.startUp,
      startMinimized: config.startMinimized,
      minimizeOnQuit: config.minimizeOnQuit,
      minimizeToTray: config.minimizeToTray,
      hideEmptyCategories: config.hideEmptyCategories,
      hardwareAcceleration: config.hardwareAcceleration,
    });
  }, [
    config.minimizeOnQuit,
    config.minimizeToTray,
    config.startMinimized,
    config.startUp,
    config.hideEmptyCategories,
    config.hardwareAcceleration,
  ]);

  useEffect(() => {
    // Seperate effect here as we need to reconfigure base after changing
    // the validateNtfs option to avoid the user needing to restart.
    if (!effect2.current) {
      effect2.current = true;
      return;
    }

    setConfigValues({ validateNtfs: config.validateNtfs });
    ipc.reconfigureBase();
  }, [config.validateNtfs]);

  const getSwitchForm = (
    preference: keyof ConfigurationSchema,
    label: Phrase,
    changeFn: (checked: boolean) => void,
    help: Phrase,
  ) => (
    <SettingRow
      label={getLocalePhrase(appState.language, label)}
      help={getLocalePhrase(appState.language, help)}
      htmlFor={sid(preference)}
    >
      <Switch
        id={sid(preference)}
        checked={Boolean(config[preference])}
        name={preference}
        onCheckedChange={changeFn}
      />
    </SettingRow>
  );

  const setRunOnStartup = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        startUp: checked,
      };
    });
  };

  const setStartMinimized = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        startMinimized: checked,
      };
    });
  };

  const setMinimizeOnQuit = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        minimizeOnQuit: checked,
      };
    });
  };

  const setMinimizeToTray = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        minimizeToTray: checked,
      };
    });
  };

  const setHardwareAcceleration = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        hardwareAcceleration: checked,
      };
    });
  };

  const setValidateNtfs = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        validateNtfs: checked,
      };
    });
  };

  return (
    <SettingsSection
      title={getLocalePhrase(appState.language, Phrase.WindowsSettingsLabel)}
    >
      {getSwitchForm(
        'startUp',
        Phrase.RunOnStartupLabel,
        setRunOnStartup,
        Phrase.StartUpDescription,
      )}
      {getSwitchForm(
        'startMinimized',
        Phrase.StartMinimizedLabel,
        setStartMinimized,
        Phrase.StartMinimizedDescription,
      )}
      {getSwitchForm(
        'minimizeOnQuit',
        Phrase.MinimizeOnQuitLabel,
        setMinimizeOnQuit,
        Phrase.MinimizeOnQuitDescription,
      )}
      {getSwitchForm(
        'minimizeToTray',
        Phrase.MinimizeToTrayLabel,
        setMinimizeToTray,
        Phrase.MinimizeToTrayDescription,
      )}
      {getSwitchForm(
        'hardwareAcceleration',
        Phrase.HardwareAccelerationLabel,
        setHardwareAcceleration,
        Phrase.HardwareAccelerationDescription,
      )}
      {getSwitchForm(
        'validateNtfs',
        Phrase.ValidateNtfsLabel,
        setValidateNtfs,
        Phrase.ValidateNtfsDescription,
      )}
    </SettingsSection>
  );
};

export default WindowsSettings;
