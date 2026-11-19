import * as React from 'react';
import { configSchema, ConfigurationSchema } from 'config/configSchema';
import { Dispatch, SetStateAction } from 'react';
import { getLocalePhrase, Language } from 'localisation/translations';
import { AppState } from 'main/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/Select/Select';
import { setConfigValues } from './useSettings';
import Switch from './components/Switch/Switch';
import { Phrase } from 'localisation/phrases';
import {
  SettingRow,
  useScopedIds,
  SettingsSection,
  settingsFieldClass,
} from './components/SettingsCard/SettingsCard';

interface IProps {
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
}

const LocaleSettings = (props: IProps) => {
  const sid = useScopedIds();
  const { config, setConfig, appState, setAppState } = props;
  const initialRender = React.useRef(true);

  React.useEffect(() => {
    // Don't fire on the initial render.
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    setConfigValues({
      language: config.language,
    });
  }, [config.language]);

  const mapLanguageToSelectItem = (lang: string) => {
    return (
      <SelectItem key={lang} value={lang}>
        {lang}
      </SelectItem>
    );
  };

  const setLanguage = (value: Language) => {
    setAppState((prevState) => {
      return {
        ...prevState,
        language: value,
      };
    });

    setConfig((prevState) => {
      return {
        ...prevState,
        language: value,
      };
    });
  };

  const setHideEmptyCategories = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        hideEmptyCategories: checked,
      };
    });
  };

  const language = appState.language;

  return (
    <SettingsSection
      title={getLocalePhrase(language, Phrase.LocaleSettingsLabel)}
    >
      <SettingRow
        label={getLocalePhrase(language, Phrase.LanguageLabel)}
        help="Pages from Warcraft Recorder are translated. Room Forty pages are English."
        htmlFor={sid('language')}
      >
        <Select value={String(config.language)} onValueChange={setLanguage}>
          <SelectTrigger
            id={sid('language')}
            className={`${settingsFieldClass} w-48`}
          >
            <SelectValue
              placeholder={getLocalePhrase(language, Phrase.SelectLanguage)}
            />
          </SelectTrigger>
          <SelectContent>
            {Object.values(Language).map(mapLanguageToSelectItem)}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label={getLocalePhrase(language, Phrase.HideEmptyCategoriesLabel)}
        help={getLocalePhrase(
          language,
          configSchema.hideEmptyCategories.description,
        )}
        htmlFor={sid('hideEmptyCategories')}
      >
        <Switch
          id={sid('hideEmptyCategories')}
          checked={Boolean(config.hideEmptyCategories)}
          name="hideEmptyCategories"
          onCheckedChange={setHideEmptyCategories}
        />
      </SettingRow>
    </SettingsSection>
  );
};

export default LocaleSettings;
