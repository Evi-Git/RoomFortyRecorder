import { configSchema } from 'config/configSchema';
import React from 'react';
import { getLocalePhrase } from 'localisation/translations';
import { AppState } from 'main/types';
import { setConfigValues, useSettings } from './useSettings';
import Switch from './components/Switch/Switch';
import { Input } from './components/Input/Input';
import {
  SettingRow,
  SettingsSection,
  settingsFieldClass,
} from './components/SettingsCard/SettingsCard';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from './components/Select/Select';
import { Phrase } from 'localisation/phrases';

const raidDifficultyOptions = [
  { name: 'LFR', phrase: Phrase.LFR },
  { name: 'Normal', phrase: Phrase.Normal },
  { name: 'Heroic', phrase: Phrase.Heroic },
  { name: 'Mythic', phrase: Phrase.Mythic },
];

interface IProps {
  appState: AppState;
}

const PVESettings = (props: IProps) => {
  const { appState } = props;
  const [config, setConfig] = useSettings();
  const initialRender = React.useRef(true);

  React.useEffect(() => {
    // Don't fire on the initial render.
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    const toSet: Record<string, boolean | string | number> = {
      recordRaids: config.recordRaids,
      minEncounterDuration: config.minEncounterDuration,
      minRaidDifficulty: config.minRaidDifficulty,
      recordDungeons: config.recordDungeons,
      raidOverrun: config.raidOverrun,
      dungeonOverrun: config.dungeonOverrun,
      recordCurrentRaidEncountersOnly: config.recordCurrentRaidEncountersOnly,
    };

    // Only set these if they are valid values. We allow -1 set in the
    // frontend to represent temporarily unset values in the Input fields.
    if (config.minEncounterDuration >= 0) {
      toSet.minEncounterDuration = config.minEncounterDuration;
    }

    if (config.raidOverrun >= 0) {
      toSet.raidOverrun = config.raidOverrun;
    }

    if (config.minKeystoneLevel >= 0) {
      toSet.minKeystoneLevel = config.minKeystoneLevel;
    }

    if (config.dungeonOverrun >= 0) {
      toSet.dungeonOverrun = config.dungeonOverrun;
    }

    setConfigValues(toSet);
  }, [
    config.dungeonOverrun,
    config.minEncounterDuration,
    config.minKeystoneLevel,
    config.minRaidDifficulty,
    config.raidOverrun,
    config.recordDungeons,
    config.recordRaids,
    config.recordCurrentRaidEncountersOnly,
  ]);

  const setRecordRaids = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        recordRaids: checked,
      };
    });
  };

  const getRecordRaidSwitch = () => {
    return (
      <SettingRow
        label={getLocalePhrase(appState.language, Phrase.RecordRaidsLabel)}
        help={getLocalePhrase(
          appState.language,
          configSchema.recordRaids.description,
        )}
        htmlFor="recordRaids"
      >
        <Switch
          id="recordRaids"
          checked={Boolean(config.recordRaids)}
          name="recordRaids"
          onCheckedChange={setRecordRaids}
        />
      </SettingRow>
    );
  };

  const setRecordCurrentRaidEncountersOnly = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        recordCurrentRaidEncountersOnly: checked,
      };
    });
  };

  const getRecordCurrentEncountersOnlySwitch = () => {
    if (!config.recordRaids) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(
          appState.language,
          Phrase.RecordCurrentRaidsOnlyLabel,
        )}
        help={getLocalePhrase(
          appState.language,
          configSchema.recordCurrentRaidEncountersOnly.description,
        )}
        htmlFor="recordCurrentRaidEncountersOnly"
      >
        <Switch
          id="recordCurrentRaidEncountersOnly"
          checked={Boolean(config.recordCurrentRaidEncountersOnly)}
          name="recordCurrentRaidEncountersOnly"
          onCheckedChange={setRecordCurrentRaidEncountersOnly}
        />
      </SettingRow>
    );
  };

  const setMinEncounterDuration = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!event.target.value) {
      // Allow setting empty as midpoint.
      setConfig((prev) => ({ ...prev, minEncounterDuration: -1 }));
      return;
    }

    const minEncounterDuration = parseInt(event.target.value, 10);

    if (Number.isNaN(minEncounterDuration)) {
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        minEncounterDuration,
      };
    });
  };

  const getMinEncounterDurationField = () => {
    if (!config.recordRaids) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(
          appState.language,
          Phrase.MinimumEncounterDurationLabel,
        )}
        help={getLocalePhrase(
          appState.language,
          configSchema.minEncounterDuration.description,
        )}
        htmlFor="minEncounterDuration"
      >
        <Input
          id="minEncounterDuration"
          value={
            config.minEncounterDuration >= 0 ? config.minEncounterDuration : ''
          }
          name="minEncounterDuration"
          onChange={setMinEncounterDuration}
          type="numeric"
          disabled={!config.recordRaids}
          className={`${settingsFieldClass} w-24`}
        />
      </SettingRow>
    );
  };

  const setMinRaidDifficulty = (value: string) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        minRaidDifficulty: value,
      };
    });
  };

  const getMinRaidDifficultySelect = () => {
    if (!config.recordRaids) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(
          appState.language,
          Phrase.MinimumRaidDifficultyLabel,
        )}
        help={getLocalePhrase(
          appState.language,
          configSchema.minRaidDifficulty.description,
        )}
        htmlFor="minRaidDifficulty"
      >
        <Select
          onValueChange={setMinRaidDifficulty}
          disabled={!config.recordRaids}
          value={config.minRaidDifficulty}
        >
          <SelectTrigger
            id="minRaidDifficulty"
            className={`${settingsFieldClass} w-44`}
          >
            <SelectValue
              placeholder={getLocalePhrase(
                appState.language,
                Phrase.SelectDifficulty,
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {raidDifficultyOptions.map((difficulty) => (
              <SelectItem key={difficulty.name} value={difficulty.name}>
                {getLocalePhrase(appState.language, difficulty.phrase)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    );
  };

  const setRaidOverrun = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) {
      // Allow setting empty as midpoint.
      setConfig((prev) => ({ ...prev, raidOverrun: -1 }));
      return;
    }

    const raidOverrun = parseInt(event.target.value, 10);

    if (Number.isNaN(raidOverrun) || raidOverrun < 0 || raidOverrun > 60) {
      // Don't allow invalid config to go further.
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        raidOverrun,
      };
    });
  };

  const getRaidOverrunField = () => {
    if (!config.recordRaids) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(appState.language, Phrase.RaidOverrunLabel)}
        help={getLocalePhrase(
          appState.language,
          configSchema.raidOverrun.description,
        )}
        htmlFor="raidOverrun"
      >
        <Input
          id="raidOverrun"
          value={config.raidOverrun >= 0 ? config.raidOverrun : ''}
          name="raidOverrun"
          onChange={setRaidOverrun}
          type="numeric"
          disabled={!config.recordRaids}
          className={`${settingsFieldClass} w-24`}
        />
      </SettingRow>
    );
  };

  const setDungeonOverrun = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) {
      // Allow setting empty as midpoint.
      setConfig((prev) => ({ ...prev, dungeonOverrun: -1 }));
      return;
    }

    const dungeonOverrun = parseInt(event.target.value, 10);

    if (
      Number.isNaN(dungeonOverrun) ||
      dungeonOverrun < 0 ||
      dungeonOverrun > 60
    ) {
      // Don't allow invalid config to go further.
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        dungeonOverrun,
      };
    });
  };

  const getDungeonOverrunField = () => {
    if (!config.recordDungeons) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(
          appState.language,
          Phrase.MythicPlusOverrunLabel,
        )}
        help={getLocalePhrase(
          appState.language,
          configSchema.dungeonOverrun.description,
        )}
        htmlFor="dungeonOverrun"
      >
        <Input
          id="dungeonOverrun"
          value={config.dungeonOverrun >= 0 ? config.dungeonOverrun : ''}
          name="dungeonOverrun"
          onChange={setDungeonOverrun}
          type="numeric"
          disabled={!config.recordDungeons}
          className={`${settingsFieldClass} w-24`}
        />
      </SettingRow>
    );
  };

  const setRecordDungeons = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        recordDungeons: checked,
      };
    });
  };

  const getRecordDungeonSwitch = () => {
    return (
      <SettingRow
        label={getLocalePhrase(appState.language, Phrase.RecordMythicPlusLabel)}
        help={getLocalePhrase(
          appState.language,
          configSchema.recordDungeons.description,
        )}
        htmlFor="recordDungeons"
      >
        <Switch
          id="recordDungeons"
          checked={Boolean(config.recordDungeons)}
          name="recordDungeons"
          onCheckedChange={setRecordDungeons}
        />
      </SettingRow>
    );
  };

  const setMinKeystoneLevel = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) {
      // Allow setting empty as midpoint.
      setConfig((prev) => ({ ...prev, minKeystoneLevel: -1 }));
      return;
    }

    const minKeystoneLevel = parseInt(event.target.value, 10);

    if (Number.isNaN(minKeystoneLevel)) {
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        minKeystoneLevel,
      };
    });
  };

  const getMinKeystoneLevelField = () => {
    if (!config.recordDungeons) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(
          appState.language,
          Phrase.MinimumKeystoneLevelLabel,
        )}
        help={getLocalePhrase(
          appState.language,
          configSchema.minKeystoneLevel.description,
        )}
        htmlFor="minKeystoneLevel"
      >
        <Input
          id="minKeystoneLevel"
          value={config.minKeystoneLevel >= 0 ? config.minKeystoneLevel : ''}
          name="minKeystoneLevel"
          onChange={setMinKeystoneLevel}
          type="numeric"
          disabled={!config.recordDungeons}
          min={2}
          className={`${settingsFieldClass} w-24`}
        />
      </SettingRow>
    );
  };

  return (
    <>
      <SettingsSection
        title={getLocalePhrase(
          appState.language,
          Phrase.VideoCategoryRaidsLabel,
        )}
      >
        {getRecordRaidSwitch()}
        {getRecordCurrentEncountersOnlySwitch()}
        {getMinRaidDifficultySelect()}
        {getMinEncounterDurationField()}
        {getRaidOverrunField()}
      </SettingsSection>

      <SettingsSection
        title={getLocalePhrase(
          appState.language,
          Phrase.VideoCategoryMythicPlusLabel,
        )}
      >
        {getRecordDungeonSwitch()}
        {getMinKeystoneLevelField()}
        {getDungeonOverrunField()}
      </SettingsSection>
    </>
  );
};

export default PVESettings;
