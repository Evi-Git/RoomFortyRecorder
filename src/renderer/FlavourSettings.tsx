import { ConfigurationSchema, configSchema } from 'config/configSchema';
import React, { Dispatch, SetStateAction } from 'react';
import { AppState, CombatLoggingStatus, RecStatus } from 'main/types';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValue, setConfigValues } from './useSettings';
import { pathSelect } from './rendererutils';
import Switch from './components/Switch/Switch';
import { Input } from './components/Input/Input';
import { Tooltip } from './components/Tooltip/Tooltip';
import TextBanner from './components/TextBanner/TextBanner';
import { FolderOpen } from 'lucide-react';
import { Phrase } from 'localisation/phrases';
import { Button } from './components/Button/Button';
import UploadStatus from './UploadStatus';
import {
  SettingRow,
  useScopedIds,
  SettingsSection,
  settingsButtonClass,
  settingsFieldClass,
} from './components/SettingsCard/SettingsCard';

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
  const sid = useScopedIds();
  const initialRender = React.useRef(true);
  // Days are all we show, so the time is read once.
  const [now] = React.useState(() => Date.now());
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
        <span className="inline-flex text-xs font-normal text-warning">
          {getLocalePhrase(
            appState.language,
            Phrase.LatestCombatLogFileNotFound,
          )}
        </span>
      );
    }

    const ageDays = Math.floor((now - mtime) / (1000 * 60 * 60 * 24));
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
      <span className="inline-flex text-xs font-normal text-success">
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
    <>
      <SettingRow
        label={getLocalePhrase(appState.language, label)}
        help={getLocalePhrase(appState.language, description)}
        htmlFor={sid(enabledKey)}
      >
        <Switch
          id={sid(enabledKey)}
          checked={enabled}
          name={enabledKey}
          onCheckedChange={(value) => setBoolean(enabledKey, value)}
          disabled={disabled}
        />
      </SettingRow>
      {enabled && (
        <SettingRow
          label={getLocalePhrase(appState.language, pathLabel)}
          help={getLocalePhrase(
            appState.language,
            configSchema[pathKey].description,
          )}
          labelId={sid(`${pathKey}-label`)}
          aside={getLastLogAgeDisplay(config[pathKey], statusKey)}
        >
          <div className="flex w-[360px] flex-col gap-y-1">
            <div className="flex gap-x-2">
              <Input
                aria-labelledby={sid(`${pathKey}-label`)}
                value={config[pathKey]}
                onClick={() => choosePath(pathKey)}
                readOnly
                required
                disabled={disabled}
                className={settingsFieldClass}
              />
              <Button
                variant="outline"
                className={settingsButtonClass}
                disabled={disabled}
                onClick={() => choosePath(pathKey)}
              >
                Browse
              </Button>
              <Tooltip
                content={getLocalePhrase(
                  appState.language,
                  Phrase.OpenFolderButtonTooltip,
                )}
                side="top"
              >
                <Button
                  variant="outline"
                  className={`${settingsButtonClass} w-9 px-0`}
                  aria-label={getLocalePhrase(
                    appState.language,
                    Phrase.OpenFolderButtonTooltip,
                  )}
                  disabled={disabled || !config[pathKey]}
                  onClick={() => ipc.openSystemExplorer(config[pathKey])}
                >
                  <FolderOpen size={18} />
                </Button>
              </Tooltip>
            </div>
            {!config[pathKey] && (
              <span className="text-error-text text-sm">
                {getLocalePhrase(appState.language, invalid)}
              </span>
            )}
            {!combatLoggingStatus[statusKey].advanced && (
              <span className="text-error-text text-sm">
                {getLocalePhrase(
                  appState.language,
                  Phrase.AdvancedCombatLoggingDisabledWarning,
                )}
              </span>
            )}
          </div>
        </SettingRow>
      )}
    </>
  );

  return (
    <SettingsSection
      title={getLocalePhrase(appState.language, Phrase.GameSettingsLabel)}
    >
      {disabled && (
        <div className="px-[18px] py-3.5">
          <TextBanner>
            {getLocalePhrase(appState.language, Phrase.SettingsDisabledText)}
          </TextBanner>
        </div>
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
      <SettingRow
        label="Send my logs"
        help={
          <>
            Upload your combat log for each raid pull to the guild server, for
            the Dashboard and Logs. Only one raider&apos;s upload is used per
            pull.
            <div className="mt-2 max-w-[460px]">
              <UploadStatus
                uploadOn={config.pullDeskUpload !== false}
                signIn={appState.cloudStatus?.signIn}
                hasLogFolder={
                  (config.recordRetail && !!config.retailLogPath) ||
                  (config.recordRetailPtr && !!config.retailPtrLogPath)
                }
              />
            </div>
          </>
        }
        htmlFor={sid('pullDeskUpload')}
      >
        <Switch
          id={sid('pullDeskUpload')}
          checked={config.pullDeskUpload !== false}
          name="pullDeskUpload"
          onCheckedChange={(value) => {
            setConfig((previous) => ({ ...previous, pullDeskUpload: value }));
            setConfigValue('pullDeskUpload', value);
          }}
        />
      </SettingRow>
    </SettingsSection>
  );
};

export default FlavourSettings;
