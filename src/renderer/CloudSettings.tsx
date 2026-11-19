import { configSchema, ConfigurationSchema } from 'config/configSchema';
import {
  AppState,
  Character,
  CharacterFilter,
  RendererVideo,
} from 'main/types';
import {
  Check,
  Eraser,
  LogIn,
  LogOut,
  MonitorPlay,
  Pencil,
  PlusIcon,
  Trash,
  X,
} from 'lucide-react';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValue, setConfigValues } from './useSettings';
import Switch from './components/Switch/Switch';
import { Tooltip } from './components/Tooltip/Tooltip';
import { Input } from './components/Input/Input';
import Progress from './components/Progress/Progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/Select/Select';
import { Phrase } from 'localisation/phrases';
import {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from './components/Button/Button';
import {
  SettingRow,
  useScopedIds,
  SettingsSection,
  settingsButtonClass,
  settingsFieldClass,
} from './components/SettingsCard/SettingsCard';
import { specImages } from './images';
import {
  formatRealmNameForDisplay,
  getSpecClass,
  getWoWClassColor,
} from './rendererutils';
import CharacterFilterDialog from './CharacterFilterDialog';

const ipc = window.electron.ipcRenderer;

const raidDifficultyOptions = [
  { name: 'LFR', phrase: Phrase.LFR },
  { name: 'Normal', phrase: Phrase.Normal },
  { name: 'Heroic', phrase: Phrase.Heroic },
  { name: 'Mythic', phrase: Phrase.Mythic },
];

let debounceTimer: NodeJS.Timeout | undefined;

interface IProps {
  appState: AppState;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
  videoState: RendererVideo[];
}

const CloudSettings = (props: IProps) => {
  const sid = useScopedIds();
  const { appState, config, setConfig, videoState } = props;
  const { language } = appState;
  const initialRender1 = useRef(true);
  const initialRender2 = useRef(true);
  const [discordAuthBusy, setDiscordAuthBusy] = useState(false);
  const [discordAuthError, setDiscordAuthError] = useState('');

  useEffect(() => {
    if (initialRender1.current) {
      initialRender1.current = false;
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      setConfigValues({
        cloudStorage: config.cloudStorage,
        cloudDiscordName: config.cloudDiscordName,
        cloudUpload: config.cloudUpload,
      });

      ipc.reconfigureCloud();

      if (!config.cloudStorage) {
        // If the user has disabled cloud storage, also
        // disable custom image overlays and reconfigure it.
        setConfig((prev) => ({ ...prev, chatOverlayOwnImage: false }));
        setConfigValues({ chatOverlayOwnImage: false });
        ipc.reconfigureOverlay();
      }
    }, 2000); // Want to be long enough that it doesn't trigger mid-typing.
  }, [
    config.cloudStorage,
    config.cloudDiscordName,
    config.cloudUpload,
    setConfig,
  ]);

  useEffect(() => {
    if (initialRender2.current) {
      initialRender2.current = false;
      return;
    }

    setConfigValues({
      characterUploadFilters: config.characterUploadFilters,
    });
  }, [config.characterUploadFilters]);

  const getSwitch = (
    preference: keyof ConfigurationSchema,
    changeFn: (checked: boolean) => void,
  ) => (
    <Switch
      id={sid(preference)}
      checked={Boolean(config[preference])}
      name={preference}
      onCheckedChange={changeFn}
    />
  );

  const getSwitchForm = (
    preference: keyof ConfigurationSchema,
    label: Phrase,
  ) => {
    const changeFn = (checked: boolean) => {
      setConfigValue(preference, checked);
      setConfig((prevState) => {
        return {
          ...prevState,
          [preference]: checked,
        };
      });
    };

    return (
      <SettingRow
        label={getLocalePhrase(language, label)}
        help={getLocalePhrase(language, configSchema[preference].description)}
        htmlFor={sid(preference)}
      >
        {getSwitch(preference, changeFn)}
      </SettingRow>
    );
  };

  const setMinRaidThreshold = (value: string) => {
    setConfigValue('cloudUploadRaidMinDifficulty', value);

    setConfig((prevState) => {
      return {
        ...prevState,
        cloudUploadRaidMinDifficulty: value,
      };
    });
  };

  const getMinRaidDifficultySelect = () => {
    if (!config.cloudUploadRaids) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.UploadDifficultyThresholdLabel)}
        help={getLocalePhrase(
          language,
          configSchema.cloudUploadRaidMinDifficulty.description,
        )}
        htmlFor={sid('cloudUploadRaidMinDifficulty')}
      >
        <Select
          onValueChange={setMinRaidThreshold}
          disabled={!config.cloudUploadRaids}
          value={config.cloudUploadRaidMinDifficulty}
        >
          <SelectTrigger
            id={sid('cloudUploadRaidMinDifficulty')}
            className={`${settingsFieldClass} w-44`}
          >
            <SelectValue
              placeholder={getLocalePhrase(language, Phrase.SelectDifficulty)}
            />
          </SelectTrigger>
          <SelectContent>
            {raidDifficultyOptions.map((difficulty) => (
              <SelectItem key={difficulty.name} value={difficulty.name}>
                {getLocalePhrase(language, difficulty.phrase)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    );
  };

  const setMinKeystoneLevel = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) {
      // Allow setting empty as midpoint.
      setConfig((prev) => ({ ...prev, cloudUploadDungeonMinLevel: -1 }));
      return;
    }

    const cloudUploadDungeonMinLevel = parseInt(event.target.value, 10);

    if (Number.isNaN(cloudUploadDungeonMinLevel)) {
      // Block invalid config.
      return;
    }

    setConfigValue('cloudUploadDungeonMinLevel', cloudUploadDungeonMinLevel);

    setConfig((prevState) => {
      return {
        ...prevState,
        cloudUploadDungeonMinLevel,
      };
    });
  };

  const getMinKeystoneLevelField = () => {
    if (!config.cloudUploadDungeons) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.UploadLevelThresholdLabel)}
        help={getLocalePhrase(
          language,
          configSchema.cloudUploadDungeonMinLevel.description,
        )}
        htmlFor={sid('cloudUploadDungeonMinLevel')}
      >
        <Input
          id={sid('cloudUploadDungeonMinLevel')}
          value={
            config.cloudUploadDungeonMinLevel >= 0
              ? config.cloudUploadDungeonMinLevel
              : ''
          }
          name="cloudUploadDungeonMinLevel"
          disabled={!config.cloudUploadDungeons}
          onChange={setMinKeystoneLevel}
          type="numeric"
          min={2}
          className={`${settingsFieldClass} w-24`}
        />
      </SettingRow>
    );
  };

  const setCloudStorage = (checked: boolean) => {
    setConfig((prevState) => {
      const cloudStorage = checked;

      const newState = {
        ...prevState,
        cloudStorage,
      };

      if (!cloudStorage) {
        // Can't have upload on if cloud storage is off so also set that
        // to false if we're disabling cloud storage.
        newState.cloudUpload = false;
      }

      return newState;
    });
  };

  const setCloudUpload = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        cloudUpload: checked,
      };
    });
  };

  const setCloudUploadRetail = (checked: boolean) => {
    setConfigValue('cloudUploadRetail', checked);

    setConfig((prevState) => {
      return {
        ...prevState,
        cloudUploadRetail: checked,
      };
    });
  };

  const getSwitchFormWith = (
    preference: keyof ConfigurationSchema,
    label: Phrase,
    changeFn: (checked: boolean) => void,
  ) => (
    <SettingRow
      label={getLocalePhrase(language, label)}
      help={getLocalePhrase(language, configSchema[preference].description)}
      htmlFor={sid(preference)}
    >
      {getSwitch(preference, changeFn)}
    </SettingRow>
  );

  const getCloudSwitch = () =>
    getSwitchFormWith(
      'cloudStorage',
      Phrase.CloudPlaybackLabel,
      setCloudStorage,
    );

  const getCloudUploadSwitch = () => {
    if (!config.cloudStorage) {
      return <></>;
    }

    return getSwitchFormWith(
      'cloudUpload',
      Phrase.CloudUploadLabel,
      setCloudUpload,
    );
  };

  const getRetailUploadSwitch = () => {
    if (!config.cloudUpload) {
      return <></>;
    }

    return getSwitchFormWith(
      'cloudUploadRetail',
      Phrase.CloudUploadRetailLabel,
      setCloudUploadRetail,
    );
  };

  const setCloudUploadRateLimit = (checked: boolean) => {
    setConfigValue('cloudUploadRateLimit', checked);

    setConfig((prevState) => {
      return {
        ...prevState,
        cloudUploadRateLimit: checked,
      };
    });
  };

  const getCloudUploadRateLimitSwitch = () => {
    if (!config.cloudUpload) {
      return <></>;
    }

    return getSwitchFormWith(
      'cloudUploadRateLimit',
      Phrase.UploadRateLimitToggleLabel,
      setCloudUploadRateLimit,
    );
  };

  const signInWithDiscord = async () => {
    setDiscordAuthError('');
    setDiscordAuthBusy(true);
    try {
      const result = await ipc.signInWithDiscord();
      setConfig((prevState) => ({
        ...prevState,
        cloudStorage: true,
        cloudDiscordName: result.userName,
      }));
    } catch (error) {
      console.error('[CloudSettings] Discord sign-in failed', error);
      setDiscordAuthError(
        'Discord sign-in failed. Check the cloud server setup.',
      );
    } finally {
      setDiscordAuthBusy(false);
    }
  };

  const signOutDiscord = async () => {
    setDiscordAuthBusy(true);
    try {
      await ipc.signOutDiscord();
      setConfig((prevState) => ({
        ...prevState,
        cloudStorage: false,
        cloudDiscordName: '',
      }));
    } catch (error) {
      console.error('[CloudSettings] Discord sign-out failed', error);
    } finally {
      setDiscordAuthBusy(false);
    }
  };

  const getDiscordAuth = () => {
    if (!config.cloudStorage) return <></>;

    const { authenticated } = appState.cloudStatus;

    return (
      <SettingRow
        label="Room Forty Discord"
        help={
          authenticated
            ? `Signed in as ${config.cloudDiscordName}.`
            : 'Sign in to play and upload recordings with the guild.'
        }
        aside={
          discordAuthError ? (
            <span className="text-error-text text-xs font-semibold">
              {discordAuthError}
            </span>
          ) : undefined
        }
      >
        {authenticated ? (
          <Button
            variant="outline"
            className={settingsButtonClass}
            onClick={signOutDiscord}
            disabled={discordAuthBusy}
          >
            <LogOut size={16} className="mr-1.5" />
            Sign out
          </Button>
        ) : (
          <Button
            onClick={signInWithDiscord}
            disabled={discordAuthBusy}
            className="h-9 rounded-lg"
          >
            <LogIn size={16} className="mr-2" />
            {discordAuthBusy
              ? 'Waiting for Discord...'
              : 'Sign in with Discord'}
          </Button>
        )}
      </SettingRow>
    );
  };

  const renderPermissionIcon = (enabled: boolean) =>
    enabled ? (
      <Check size={20} className="inline-flex ml-2" color="green" />
    ) : (
      <X size={20} className="inline-flex ml-2" color="red" />
    );

  const getPermissionDetails = (phrase: Phrase, enabled: boolean) => {
    let icon = (
      <MonitorPlay
        size={20}
        className="inline-flex mr-2 text-foreground-lighter"
      />
    );

    if (phrase === Phrase.PermissionWriteLabel) {
      icon = (
        <Pencil
          size={20}
          className="inline-flex mr-2 text-foreground-lighter"
        />
      );
    } else if (phrase === Phrase.PermissionDeleteLabel) {
      icon = (
        <Trash size={20} className="inline-flex mr-2 text-foreground-lighter" />
      );
    }

    return (
      <div>
        {icon}
        <span className="text-xs text-foreground font-semibold whitespace-nowrap">
          {getLocalePhrase(language, phrase)}
          {renderPermissionIcon(enabled)}
        </span>
      </div>
    );
  };

  const getCloudPermissions = () => {
    const { read, write, del } = appState.cloudStatus;

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.PermissionLabel)}
        help={getLocalePhrase(language, Phrase.PermissionDescription)}
      >
        <div className="flex flex-row gap-x-4">
          <Tooltip
            content={getLocalePhrase(
              language,
              Phrase.PermissionReadDescription,
            )}
          >
            {getPermissionDetails(Phrase.PermissionReadLabel, read)}
          </Tooltip>
          <Tooltip
            content={getLocalePhrase(
              language,
              Phrase.PermissionWriteDescription,
            )}
          >
            {getPermissionDetails(Phrase.PermissionWriteLabel, write)}
          </Tooltip>
          <Tooltip
            content={getLocalePhrase(
              language,
              Phrase.PermissionDeleteDescription,
            )}
          >
            {getPermissionDetails(Phrase.PermissionDeleteLabel, del)}
          </Tooltip>
        </div>
      </SettingRow>
    );
  };

  const getCloudUsageBar = () => {
    const { usage, limit } = appState.cloudStatus;
    const usageGB = usage / 1024 ** 3;
    const limitGB = limit / 1024 ** 3;
    const perc = limit > 0 ? Math.round((100 * usage) / limit) : 0;

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.CloudUsageDescription)}
        help="How much of your cloud space is used."
      >
        <div className="flex w-64 items-center gap-x-2">
          <Progress value={perc} className="h-2" />
          <span className="whitespace-nowrap text-xs font-medium text-foreground">
            {Math.round(usageGB)} of {Math.round(limitGB)} GB
          </span>
        </div>
      </SettingRow>
    );
  };

  const getCloudUploadCategorySettings = () => {
    return (
      <>
        {getSwitchForm('cloudUploadRaids', Phrase.UploadRaidsLabel)}
        {config.cloudUploadRaids &&
          getSwitchForm(
            'uploadCurrentRaidEncountersOnly',
            Phrase.UploadCurrentRaidsOnlyLabel,
          )}
        {getMinRaidDifficultySelect()}
        {getSwitchForm('cloudUploadDungeons', Phrase.UploadMythicPlusLabel)}
        {getMinKeystoneLevelField()}
        {getSwitchForm('manualRecordUpload', Phrase.ManualRecordUploadLabel)}
        {getSwitchForm('cloudUploadClips', Phrase.UploadClipsLabel)}
      </>
    );
  };

  const setUploadRateLimit = (event: ChangeEvent<HTMLInputElement>) => {
    const cloudUploadRateLimitMbps = parseInt(event.target.value, 10);

    if (Number.isNaN(cloudUploadRateLimitMbps)) {
      // Block invalid config.
      return;
    }

    setConfigValue('cloudUploadRateLimitMbps', cloudUploadRateLimitMbps);

    setConfig((prevState) => {
      return {
        ...prevState,
        cloudUploadRateLimitMbps,
      };
    });
  };

  const getRateLimitField = () => {
    if (!config.cloudUpload || !config.cloudUploadRateLimit) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.UploadRateLimitValueLabel)}
        help={getLocalePhrase(
          language,
          configSchema.cloudUploadRateLimitMbps.description,
        )}
        htmlFor={sid('cloudUploadRateLimitMbps')}
      >
        <div className="flex flex-col gap-y-1">
          <Input
            id={sid('cloudUploadRateLimitMbps')}
            name="cloudUploadRateLimitMbps"
            value={config.cloudUploadRateLimitMbps}
            onChange={setUploadRateLimit}
            spellCheck={false}
            type="numeric"
            className={`${settingsFieldClass} w-24`}
          />
          {config.cloudUploadRateLimitMbps < 1 && (
            <span className="text-error-text text-xs font-semibold">
              {getLocalePhrase(language, Phrase.OneOrGreater)}
            </span>
          )}
        </div>
      </SettingRow>
    );
  };

  const renderCharacterFilterRow = (
    filter: CharacterFilter,
    known: Map<string, Character>,
    index: number,
  ) => {
    const character = known.get(`${filter.name}:${filter.realm}`);
    let specIcon = specImages[0];
    let playerClassColor = 'gray';

    if (character) {
      const knownSpec = Object.hasOwnProperty.call(
        specImages,
        character.specID as keyof typeof specImages,
      );

      if (knownSpec) {
        specIcon = specImages[character.specID as keyof typeof specImages];
        const playerClass = getSpecClass(character.specID);
        playerClassColor = getWoWClassColor(playerClass);
      }
    }

    return (
      <tr
        key={`${filter.name}-${filter.realm}`}
        className="border-b border-panel-line last:border-b-0"
      >
        <td>
          <div className="flex items-center gap-x-1">
            <img
              src={specIcon}
              className="bg-background-higher h-6 w-6 rounded-[15%] border border-black object-cover"
            />
            <span
              className="font-sans font-semibold text-md text-shadow-instance truncate "
              style={{ color: playerClassColor }}
            >
              {filter.name}
            </span>
          </div>
        </td>
        <td>
          <span>{formatRealmNameForDisplay(filter.realm)}</span>
        </td>
        <td>
          <div className="flex items-center justify-center">
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <X
                className="text-red-500 opacity-70"
                onClick={() => clearCharacterFilter(index)}
              />
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  const renderCharacterFilterHelpText = () => {
    if (config.characterUploadFilters.length > 0) {
      return (
        <div className="flex flex-col text-[13px] text-foreground">
          {getLocalePhrase(language, Phrase.CharacterFilterActive)}
        </div>
      );
    }

    return (
      <div className="flex flex-col text-[13px] text-foreground">
        {getLocalePhrase(language, Phrase.CharacterFilterNone)}
      </div>
    );
  };

  const knownPlayers = new Map<string, Character>();

  videoState.forEach((rv) => {
    if (!rv.player) {
      return;
    }

    const { _name, _realm, _specID } = rv.player;

    if (!_name || !_realm || !_specID) {
      return;
    }

    knownPlayers.set(`${_name}:${_realm}`, {
      name: _name,
      realm: _realm,
      specID: _specID,
    });
  });

  const clearCharacterFilters = () => {
    setConfig((prev) => ({ ...prev, characterUploadFilters: [] }));
  };

  const clearCharacterFilter = (index: number) => {
    setConfig((prev) => {
      const newFilters = [...prev.characterUploadFilters];
      newFilters.splice(index, 1);
      return { ...prev, characterUploadFilters: newFilters };
    });
  };

  const getCharacterFilterSettings = () => {
    return (
      <div className="flex flex-col gap-y-3 px-[18px] py-3.5">
        {renderCharacterFilterHelpText()}
        {config.characterUploadFilters.length > 0 && (
          <table className="w-full max-w-[560px] text-sm text-foreground-lighter">
            <thead className="border-b border-panel-line text-foreground">
              <tr>
                <th className="py-1.5 text-left font-medium">Character</th>
                <th className="py-1.5 text-left font-medium">Realm</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {config.characterUploadFilters.map((filter, index) =>
                renderCharacterFilterRow(filter, knownPlayers, index),
              )}
            </tbody>
          </table>
        )}

        <div className="flex gap-2">
          <CharacterFilterDialog
            appState={appState}
            videoState={videoState}
            config={config}
            setConfig={setConfig}
          >
            <Button variant="outline" className={settingsButtonClass}>
              <PlusIcon className="mr-1" />
              {getLocalePhrase(language, Phrase.CharacterAdd)}
            </Button>
          </CharacterFilterDialog>
          <Button
            onClick={clearCharacterFilters}
            variant="outline"
            className={settingsButtonClass}
          >
            <Eraser className="mr-2" size={20} />
            {getLocalePhrase(language, Phrase.Clear)}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <SettingsSection title="Account and playback">
        {getCloudSwitch()}
        {getDiscordAuth()}
        {config.cloudStorage && getCloudUsageBar()}
        {config.cloudStorage && getCloudPermissions()}
      </SettingsSection>

      {config.cloudStorage && (
        <SettingsSection
          title={getLocalePhrase(language, Phrase.CloudUploadSettingsLabel)}
        >
          {getCloudUploadSwitch()}
          {getRetailUploadSwitch()}
          {getCloudUploadRateLimitSwitch()}
          {getRateLimitField()}
        </SettingsSection>
      )}

      {config.cloudStorage && config.cloudUpload && (
        <>
          <SettingsSection
            title={getLocalePhrase(language, Phrase.CloudFilterSettingsLabel)}
          >
            {getCloudUploadCategorySettings()}
          </SettingsSection>
          <SettingsSection
            title={getLocalePhrase(
              language,
              Phrase.CloudAdvancedFilterSettingsLabel,
            )}
          >
            {getCharacterFilterSettings()}
          </SettingsSection>
        </>
      )}
    </>
  );
};

export default CloudSettings;
