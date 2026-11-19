import { configSchema, ConfigurationSchema } from 'config/configSchema';
import React, {
  Dispatch,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'main/types';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValues } from './useSettings';
import Switch from './components/Switch/Switch';
import { Phrase } from 'localisation/phrases';
import { Input } from './components/Input/Input';
import {
  SettingRow,
  useScopedIds,
  SettingsSection,
  settingsFieldClass,
} from './components/SettingsCard/SettingsCard';
import {
  getKeyModifiersString,
  getKeyPressEventString,
  getManualRecordHotKeyFromConfig,
  getNextKeyOrMouseEvent,
} from './rendererutils';
import { PTTEventType, PTTKeyPressEvent } from 'types/KeyTypesUIOHook';

interface IProps {
  appState: AppState;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
}

const ManualSettings = (props: IProps) => {
  const sid = useScopedIds();
  const { appState, config, setConfig } = props;
  const initialRender = useRef(true);
  const manualHotKeyInputRef = useRef<HTMLInputElement>(null);

  const [manualHotKeyFieldFocused, setManualHotKeyFieldFocused] =
    useState(false);

  const [manualHotKey, setManualHotKey] = useState<PTTKeyPressEvent>(
    getManualRecordHotKeyFromConfig(config),
  );

  useEffect(() => {
    const setManualKeyConfig = (event: PTTKeyPressEvent) => {
      setConfig((prevState) => {
        return {
          ...prevState,
          manualRecordHotKey: event.keyCode,
          manualRecordHotKeyModifiers: getKeyModifiersString(event),
        };
      });
    };

    const listenNextKeyPress = async () => {
      if (manualHotKeyFieldFocused) {
        let keyPressEvent = await getNextKeyOrMouseEvent();

        while (
          keyPressEvent.type === PTTEventType.EVENT_MOUSE_PRESSED ||
          keyPressEvent.type === PTTEventType.EVENT_MOUSE_RELEASED
        ) {
          // Don't accept mouse events
          keyPressEvent = await getNextKeyOrMouseEvent();
        }

        setManualHotKeyFieldFocused(false);
        setManualHotKey(keyPressEvent);
        setManualKeyConfig(keyPressEvent);
        manualHotKeyInputRef.current?.blur();
      }
    };

    listenNextKeyPress();
  }, [manualHotKeyFieldFocused, setConfig]);

  useEffect(() => {
    // Don't fire on the initial render.
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    setConfigValues({
      manualRecord: config.manualRecord,
      manualRecordHotKey: config.manualRecordHotKey,
      manualRecordHotKeyModifiers: config.manualRecordHotKeyModifiers,
      manualRecordSoundAlert: config.manualRecordSoundAlert,
    });
  }, [
    config.manualRecord,
    config.manualRecordHotKey,
    config.manualRecordHotKeyModifiers,
    config.manualRecordSoundAlert,
  ]);

  const getSwitchForm = (
    preference: keyof ConfigurationSchema,
    label: Phrase,
    changeFn: (checked: boolean) => void,
  ) => {
    return (
      <SettingRow
        label={getLocalePhrase(appState.language, label)}
        help={getLocalePhrase(
          appState.language,
          configSchema[preference].description,
        )}
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
  };

  const setRecordManual = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        manualRecord: checked,
      };
    });
  };

  const setSoundAlert = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        manualRecordSoundAlert: checked,
      };
    });
  };

  const getHotkeyString = () => {
    if (manualHotKeyFieldFocused) {
      return getLocalePhrase(appState.language, Phrase.PressAnyKeyCombination);
    }

    if (manualHotKey !== null) {
      return `${getKeyPressEventString(manualHotKey, appState)} (${getLocalePhrase(
        appState.language,
        Phrase.ClickToRebind,
      )})`;
    }

    return getLocalePhrase(appState.language, Phrase.ClickToBind);
  };

  const getManualHotKeySelect = () => {
    return (
      <SettingRow
        label={getLocalePhrase(
          appState.language,
          Phrase.ManualRecordHotKeyLabel,
        )}
        help={getLocalePhrase(
          appState.language,
          Phrase.ManualRecordHotKeyDescription,
        )}
        labelId={sid('manualHotKeyInput-label')}
      >
        <Input
          aria-labelledby={sid('manualHotKeyInput-label')}
          ref={manualHotKeyInputRef}
          name="manualHotKeyInput"
          value={getHotkeyString()}
          onFocus={() => setManualHotKeyFieldFocused(true)}
          onBlur={() => setManualHotKeyFieldFocused(false)}
          readOnly
          className={`${settingsFieldClass} w-60`}
        />
      </SettingRow>
    );
  };

  return (
    <SettingsSection
      title={getLocalePhrase(
        appState.language,
        Phrase.ManualRecordSettingsLabel,
      )}
    >
      {getSwitchForm(
        'manualRecord',
        Phrase.ManualRecordSwitchLabel,
        setRecordManual,
      )}

      {config.manualRecord &&
        getSwitchForm(
          'manualRecordSoundAlert',
          Phrase.ManualRecordSoundAlertLabel,
          setSoundAlert,
        )}

      {config.manualRecord && getManualHotKeySelect()}
    </SettingsSection>
  );
};

export default ManualSettings;
