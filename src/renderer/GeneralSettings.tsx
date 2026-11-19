import * as React from 'react';
import { configSchema } from 'config/configSchema';
import { AppState, RecStatus } from 'main/types';
import { useEffect, useRef } from 'react';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValues, useSettings } from './useSettings';
import { pathSelect } from './rendererutils';
import { Input } from './components/Input/Input';
import Switch from './components/Switch/Switch';
import Progress from './components/Progress/Progress';
import TextBanner from './components/TextBanner/TextBanner';
import { Phrase } from 'localisation/phrases';
import { Button } from './components/Button/Button';
import {
  SettingRow,
  SettingsSection,
  settingsButtonClass,
  settingsFieldClass,
} from './components/SettingsCard/SettingsCard';

interface IProps {
  recorderStatus: RecStatus;
  appState: AppState;
}

const ipc = window.electron.ipcRenderer;
let debounceTimeout: NodeJS.Timeout | null;

const GeneralSettings: React.FC<IProps> = (props: IProps) => {
  const { recorderStatus, appState } = props;
  const { language } = appState;
  const [config, setConfig] = useSettings();
  const initialRenderVideoConfig = useRef(true);

  useEffect(() => {
    if (initialRenderVideoConfig.current) {
      // Drop out if initial render, we don't care about settings
      // changes until the user has had a chance to make some.
      initialRenderVideoConfig.current = false;
      return;
    }

    const toSet: Record<string, unknown> = {
      storagePath: config.storagePath,
      bufferStoragePath: config.bufferStoragePath,
      separateBufferPath: config.separateBufferPath,
    };

    if (config.maxStorage >= 0) {
      toSet.maxStorage = config.maxStorage;
    }

    setConfigValues(toSet);

    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    debounceTimeout = setTimeout(() => {
      ipc.reconfigureBase();
    }, 500);
  }, [
    config.separateBufferPath,
    config.storagePath,
    config.bufferStoragePath,
    config.maxStorage,
  ]);

  const setSeparateBufferPath = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        bufferStoragePath: '',
        separateBufferPath: checked,
      };
    });
  };

  const isComponentDisabled = () => {
    const isRecording = recorderStatus === RecStatus.Recording;
    const isOverrunning = recorderStatus === RecStatus.Overrunning;
    return isRecording || isOverrunning;
  };

  const getDisabledText = () => {
    if (!isComponentDisabled()) {
      return <></>;
    }

    return (
      <TextBanner>
        {getLocalePhrase(language, Phrase.SettingsDisabledText)}
      </TextBanner>
    );
  };

  const setStoragePath = async () => {
    const newPath = await pathSelect();

    if (newPath === '') {
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        storagePath: newPath,
      };
    });
  };

  const getStoragePathField = () => {
    if (isComponentDisabled()) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.DiskStorageFolderLabel)}
        help={getLocalePhrase(language, configSchema.storagePath.description)}
        htmlFor="storagePath"
      >
        <div className="flex w-[340px] flex-col gap-y-1">
          <div className="flex gap-x-2">
            <Input
              id="storagePath"
              name="storagePath"
              value={config.storagePath}
              onClick={setStoragePath}
              required
              disabled={isComponentDisabled()}
              readOnly
              className={settingsFieldClass}
            />
            <Button
              variant="outline"
              className={settingsButtonClass}
              onClick={setStoragePath}
            >
              Browse
            </Button>
          </div>
          {config.storagePath === '' && (
            <span className="text-error text-sm">
              {getLocalePhrase(language, Phrase.MustNotBeEmpty)}
            </span>
          )}
        </div>
      </SettingRow>
    );
  };

  const setBufferPath = async () => {
    if (isComponentDisabled()) {
      return;
    }

    const newPath = await pathSelect();

    if (newPath === '') {
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        bufferStoragePath: newPath,
      };
    });
  };

  const getBufferSwitch = () => {
    if (isComponentDisabled()) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.SeparateBufferFolderLabel)}
        help={getLocalePhrase(
          language,
          configSchema.separateBufferPath.description,
        )}
        htmlFor="separateBufferPath"
      >
        <Switch
          id="separateBufferPath"
          checked={Boolean(config.separateBufferPath)}
          name="separateBufferPath"
          onCheckedChange={setSeparateBufferPath}
        />
      </SettingRow>
    );
  };

  const getBufferPathField = () => {
    if (isComponentDisabled()) {
      return <></>;
    }

    if (!config.separateBufferPath) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.BufferFolderLabel)}
        help={getLocalePhrase(
          language,
          configSchema.bufferStoragePath.description,
        )}
        htmlFor="bufferStoragePath"
      >
        <div className="flex w-[340px] gap-x-2">
          <Input
            id="bufferStoragePath"
            name="bufferStoragePath"
            value={config.bufferStoragePath}
            onClick={setBufferPath}
            required
            disabled={isComponentDisabled()}
            readOnly
            className={settingsFieldClass}
          />
          <Button
            variant="outline"
            className={settingsButtonClass}
            onClick={setBufferPath}
          >
            Browse
          </Button>
        </div>
      </SettingRow>
    );
  };

  const setMaxStorage = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) {
      // Allow setting empty as midpoint.
      setConfig((prev) => ({ ...prev, maxStorage: -1 }));
      return;
    }

    const maxStorage = parseInt(event.target.value, 10);

    if (Number.isNaN(maxStorage) || maxStorage < 0) {
      // Block invalid config.
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        maxStorage,
      };
    });
  };

  const getMaxStorageField = () => {
    if (isComponentDisabled()) {
      return <></>;
    }

    const usage = Math.round(appState.diskStatus.usage / 1024 ** 3);
    const max = Math.round(appState.diskStatus.limit / 1024 ** 3);
    let perc = max === 0 ? 100 : (100 * usage) / max;
    if (perc > 100) perc = 100;
    const text = max === 0 ? `${usage} GB used` : `${usage} of ${max} GB`;

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.MaxDiskStorageLabel)}
        help={getLocalePhrase(language, configSchema.maxStorage.description)}
        htmlFor="maxDiskStorage"
      >
        <div className="flex items-center gap-x-4">
          <div
            className="flex w-44 items-center gap-x-2"
            title={getLocalePhrase(language, Phrase.DiskUsageDescription)}
          >
            <Progress value={perc} className="h-2" />
            <span className="whitespace-nowrap text-xs font-medium text-foreground">
              {text}
            </span>
          </div>
          <Input
            id="maxDiskStorage"
            name="maxDiskStorage"
            value={config.maxStorage >= 0 ? config.maxStorage : ''}
            onChange={setMaxStorage}
            required
            type="numeric"
            disabled={isComponentDisabled()}
            className={`${settingsFieldClass} w-20`}
          />
        </div>
      </SettingRow>
    );
  };

  return (
    <SettingsSection
      title={getLocalePhrase(language, Phrase.GeneralSettingsLabel)}
    >
      {isComponentDisabled() && (
        <div className="px-[18px] py-3.5">{getDisabledText()}</div>
      )}
      {getStoragePathField()}
      {getMaxStorageField()}
      {getBufferSwitch()}
      {getBufferPathField()}
    </SettingsSection>
  );
};

export default GeneralSettings;
