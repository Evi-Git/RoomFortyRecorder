import { ConfigurationSchema, configSchema } from 'config/configSchema';
import React, { Dispatch, SetStateAction } from 'react';
import { AppState, CombatLoggingStatus, RecStatus } from 'main/types';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValue, setConfigValues } from './useSettings';
import { pathSelect } from './rendererutils';
import Switch from './components/Switch/Switch';
import Label from './components/Label/Label';
import { Input } from './components/Input/Input';
import { Tooltip } from './components/Tooltip/Tooltip';
import TextBanner from './components/TextBanner/TextBanner';
import { FolderOpen, Info } from 'lucide-react';
import { Phrase } from 'localisation/phrases';
import { Button } from './components/Button/Button';

interface IProps {
  recorderStatus: RecStatus;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
  appState: AppState;
  combatLoggingStatus: CombatLoggingStatus;
}

const ipc = window.electron.ipcRenderer;

const FlavourSettings: React.FC<IProps> = ({
  recorderStatus,
  config,
  setConfig,
  appState,
  combatLoggingStatus,
}) => {
  const initialRender = React.useRef(true);
  const disabled =
    recorderStatus === RecStatus.Recording ||
    recorderStatus === RecStatus.Overrunning;

  React.useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      ipc.refreshCombatLogStatus();
      return;
    }

    setConfigValues({
      recordRetail: config.recordRetail,
      retailLogPath: config.retailLogPath,
      recordRetailPtr: config.recordRetailPtr,
      retailPtrLogPath: config.retailPtrLogPath,
      validateLogPaths: config.validateLogPaths,
    });

    ipc.reconfigureBase();
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

  const getLastLogAgeDisplay = (
    path: string,
    key: keyof CombatLoggingStatus,
  ) => {
    if (!path) return null;

    const mtime = combatLoggingStatus[key].latestLogAgeMs;
    if (mtime === -1) {
      return (
        <span className="inline-flex ml-2 text-xs font-normal text-warning">
          {getLocalePhrase(
            appState.language,
            Phrase.LatestCombatLogFileNotFound,
          )}
        </span>
      );
    }

    const ageDays = Math.floor((Date.now() - mtime) / (1000 * 60 * 60 * 24));
    const age =
      ageDays > 31
        ? getLocalePhrase(
            appState.language,
            Phrase.LatestCombatLogFileOverAMonthOld,
          )
        : ageDays > 1
          ? `${ageDays} ${getLocalePhrase(
              appState.language,
              Phrase.LatestCombatLogFileDaysOld,
            )}`
          : ageDays === 1
            ? getLocalePhrase(
                appState.language,
                Phrase.LatestCombatLogFileDayOld,
              )
            : getLocalePhrase(
                appState.language,
                Phrase.LatestCombatLogFileLessThanADayOld,
              );

    return (
      <span className="inline-flex ml-2 text-xs font-normal text-success">
        {getLocalePhrase(appState.language, Phrase.LatestCombatLogFileText)}{' '}
        {age}
      </span>
    );
  };

  const getPathSetting = (
    enabled: boolean,
    enabledKey: 'recordRetail' | 'recordRetailPtr',
    pathKey: 'retailLogPath' | 'retailPtrLogPath',
    statusKey: keyof CombatLoggingStatus,
    label: Phrase,
    pathLabel: Phrase,
    description: Phrase,
    invalid: Phrase,
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
            {getLocalePhrase(appState.language, pathLabel)}
            <Tooltip
              content={getLocalePhrase(
                appState.language,
                configSchema[pathKey].description,
              )}
              side="top"
            >
              <Info size={20} className="inline-flex ml-2" />
            </Tooltip>
            {getLastLogAgeDisplay(config[pathKey], statusKey)}
          </Label>
          <div className="flex">
            <Input
              value={config[pathKey]}
              onClick={() => choosePath(pathKey)}
              readOnly
              required
              disabled={disabled}
            />
            <Tooltip
              content={getLocalePhrase(
                appState.language,
                Phrase.OpenFolderButtonTooltip,
              )}
              side="top"
            >
              <Button
                variant="ghost"
                disabled={disabled || !config[pathKey]}
                onClick={() => ipc.openSystemExplorer(config[pathKey])}
              >
                <FolderOpen size={20} />
              </Button>
            </Tooltip>
          </div>
          {!config[pathKey] && (
            <span className="text-error text-sm">
              {getLocalePhrase(appState.language, invalid)}
            </span>
          )}
          {!combatLoggingStatus[statusKey].advanced && (
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
        'retail',
        Phrase.RecordRetailLabel,
        Phrase.RetailLogPathLabel,
        configSchema.recordRetail.description,
        Phrase.InvalidRetailLogPathText,
      )}
      {getPathSetting(
        config.recordRetailPtr,
        'recordRetailPtr',
        'retailPtrLogPath',
        'retailPtr',
        Phrase.RecordRetailPtrLabel,
        Phrase.RetailPtrLogPathLabel,
        configSchema.recordRetailPtr.description,
        Phrase.InvalidRetailPtrLogPathText,
      )}
      {/* [RoomFortyRecorder] Upload this PC's pull logs to the guild server. */}
      <div className="flex flex-col w-[160px]">
        <Label htmlFor="pullDeskUpload" className="flex items-center">
          Send my Logs
          <Tooltip
            content="When on, your app may upload your combat log for each raid pull to the guild server (Dashboard and Logs). Only one raider's upload is used per pull."
            side="top"
          >
            <Info size={20} className="inline-flex ml-2" />
          </Tooltip>
        </Label>
        <div className="flex h-10 items-center">
          <Switch
            checked={config.pullDeskUpload !== false}
            name="pullDeskUpload"
            onCheckedChange={(value) => {
              setConfig((previous) => ({ ...previous, pullDeskUpload: value }));
              setConfigValue('pullDeskUpload', value);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default FlavourSettings;
