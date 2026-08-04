import { ConfigurationSchema, configSchema } from 'config/configSchema';
import React, { Dispatch, SetStateAction } from 'react';
import { AdvancedLoggingStatus, AppState, RecStatus } from 'main/types';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValues } from './useSettings';
import { pathSelect } from './rendererutils';
import Switch from './components/Switch/Switch';
import Label from './components/Label/Label';
import { Input } from './components/Input/Input';
import { Tooltip } from './components/Tooltip/Tooltip';
import TextBanner from './components/TextBanner/TextBanner';
import { Info } from 'lucide-react';
import { Phrase } from 'localisation/phrases';

interface IProps {
  recorderStatus: RecStatus;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
  appState: AppState;
  advancedLoggingStatus: AdvancedLoggingStatus;
}

const FlavourSettings: React.FC<IProps> = ({
  recorderStatus,
  config,
  setConfig,
  appState,
  advancedLoggingStatus,
}) => {
  const initialRender = React.useRef(true);
  const disabled =
    recorderStatus === RecStatus.Recording ||
    recorderStatus === RecStatus.Overrunning;

  React.useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    setConfigValues({
      recordRetail: config.recordRetail,
      retailLogPath: config.retailLogPath,
      recordRetailPtr: config.recordRetailPtr,
      retailPtrLogPath: config.retailPtrLogPath,
      validateLogPaths: config.validateLogPaths,
    });

    window.electron.ipcRenderer.reconfigureBase();
  }, [
    config.recordRetail,
    config.retailLogPath,
    config.recordRetailPtr,
    config.retailPtrLogPath,
    config.validateLogPaths,
  ]);

  const setBoolean = (
    key: 'recordRetail' | 'recordRetailPtr',
    value: boolean,
  ) => {
    setConfig((previous) => ({ ...previous, [key]: value }));
  };

  const choosePath = async (key: 'retailLogPath' | 'retailPtrLogPath') => {
    if (disabled) return;
    const value = await pathSelect();
    if (value) setConfig((previous) => ({ ...previous, [key]: value }));
  };

  const getPathSetting = (
    enabled: boolean,
    enabledKey: 'recordRetail' | 'recordRetailPtr',
    pathKey: 'retailLogPath' | 'retailPtrLogPath',
    label: Phrase,
    description: Phrase,
    invalid: Phrase,
    warning: boolean,
  ) => (
    <div className="flex flex-row gap-x-6">
      <div className="flex flex-col w-[160px]">
        <Label htmlFor={enabledKey} className="flex items-center">
          {getLocalePhrase(appState.language, label)}
          <Tooltip
            content={getLocalePhrase(appState.language, description)}
            side="top"
          >
            <Info size={20} className="inline-flex ml-2" />
          </Tooltip>
        </Label>
        <div className="flex h-10 items-center">
          <Switch
            checked={enabled}
            name={enabledKey}
            onCheckedChange={(value) => setBoolean(enabledKey, value)}
            disabled={disabled}
          />
        </div>
      </div>
      {enabled && (
        <div className="flex flex-col w-1/2">
          <Label htmlFor={pathKey} className="flex items-center">
            {getLocalePhrase(appState.language, label)}
          </Label>
          <Input
            value={config[pathKey]}
            onClick={() => choosePath(pathKey)}
            readOnly
            required
            disabled={disabled}
          />
          {!config[pathKey] && (
            <span className="text-error text-sm">
              {getLocalePhrase(appState.language, invalid)}
            </span>
          )}
          {!warning && (
            <span className="text-error text-sm">
              {getLocalePhrase(
                appState.language,
                Phrase.AdvancedCombatLoggingDisabledWarning,
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-y-4">
      {disabled && (
        <TextBanner>
          {getLocalePhrase(appState.language, Phrase.SettingsDisabledText)}
        </TextBanner>
      )}
      {getPathSetting(
        config.recordRetail,
        'recordRetail',
        'retailLogPath',
        Phrase.RecordRetailLabel,
        configSchema.recordRetail.description,
        Phrase.InvalidRetailLogPathText,
        advancedLoggingStatus.retail,
      )}
      {getPathSetting(
        config.recordRetailPtr,
        'recordRetailPtr',
        'retailPtrLogPath',
        Phrase.RecordRetailPtrLabel,
        configSchema.recordRetailPtr.description,
        Phrase.InvalidRetailPtrLogPathText,
        advancedLoggingStatus.retailPtr,
      )}
    </div>
  );
};

export default FlavourSettings;
