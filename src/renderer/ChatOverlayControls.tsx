import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { configSchema, ConfigurationSchema } from 'config/configSchema';
import { Lock } from 'lucide-react';
import { AppState, SceneItem } from 'main/types';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValues } from './useSettings';
import { imageSelect } from './rendererutils';
import {
  SettingRow,
  settingsFieldClass,
  useScopedIds,
} from './components/SettingsCard/SettingsCard';
import Switch from './components/Switch/Switch';
import { Input } from './components/Input/Input';
import { Phrase } from 'localisation/phrases';
import Slider from './components/Slider/Slider';

const ipc = window.electron.ipcRenderer;

interface IProps {
  appState: AppState;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
}

const ChatOverlayControls = (props: IProps) => {
  const { appState, config, setConfig } = props;
  const { cloudStatus } = appState;
  const sid = useScopedIds();
  const initialRender = useRef(true);

  const [cropMaxX, setCropMaxX] = useState(0);
  const [cropMaxY, setCropMaxY] = useState(0);

  const initCropSliders = async () => {
    if (!config.chatOverlayEnabled) return;
    const pos = await ipc.getSourcePosition(SceneItem.OVERLAY);
    // Don't let them scale to less than 80% of the dimension.
    // That seems reasonable to avoid weird issues.
    setCropMaxX(0.8 * Math.round(pos.width / 2));
    setCropMaxY(0.8 * Math.round(pos.height / 2));
  };

  useEffect(() => {
    if (initialRender.current) return;

    setConfigValues({
      chatOverlayEnabled: config.chatOverlayEnabled,
      chatOverlayOwnImage: config.chatOverlayOwnImage,
      chatOverlayOwnImagePath: config.chatOverlayOwnImagePath,
    });

    ipc.reconfigureOverlay();
  }, [
    config.chatOverlayEnabled,
    config.chatOverlayOwnImage,
    config.chatOverlayOwnImagePath,
  ]);

  useEffect(() => {
    // If the user changes an overlay source, it will fire the source
    //  callback, which we react to to ensure the sliders are sensible.
    ipc.on('initCropSliders', initCropSliders);

    return () => {
      ipc.removeAllListeners('initCropSliders');
    };
  }, [initCropSliders]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- false positive: initCropSliders sets state only after an awaited IPC call
    initCropSliders();
    initialRender.current = false;
  }, []);

  const setOverlayEnabled = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        chatOverlayEnabled: checked,
      };
    });
  };

  const setOwnImage = (checked: boolean) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        chatOverlayOwnImage: checked,
      };
    });
  };

  const getChatOverlayEnabledSwitch = () => {
    return (
      <SettingRow
        label={getLocalePhrase(appState.language, Phrase.ChatOverlayLabel)}
        help={getLocalePhrase(
          appState.language,
          configSchema.chatOverlayEnabled.description,
        )}
        htmlFor={sid('overlay')}
      >
        <Switch
          id={sid('overlay')}
          checked={config.chatOverlayEnabled}
          onCheckedChange={setOverlayEnabled}
        />
      </SettingRow>
    );
  };

  const getChatOverlayOwnImageSwitch = () => {
    return (
      <SettingRow
        label={getLocalePhrase(appState.language, Phrase.OwnImageLabel)}
        aside={
          !cloudStatus.authorized && (
            <Lock size={14} className="self-center text-foreground" />
          )
        }
        help={getLocalePhrase(
          appState.language,
          configSchema.chatOverlayOwnImage.description,
        )}
        htmlFor={sid('ownImage')}
      >
        <Switch
          id={sid('ownImage')}
          checked={config.chatOverlayOwnImage}
          onCheckedChange={setOwnImage}
          disabled={
            !config.chatOverlayOwnImage &&
            (!config.chatOverlayEnabled || !cloudStatus.authorized)
          }
        />
      </SettingRow>
    );
  };

  const setOverlayPath = async () => {
    const newPath = await imageSelect();

    if (newPath === '') {
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        chatOverlayOwnImagePath: newPath,
      };
    });
  };

  const getOwnImagePathField = () => {
    return (
      <SettingRow
        label={getLocalePhrase(appState.language, Phrase.ImagePathLabel)}
        help={getLocalePhrase(
          appState.language,
          configSchema.chatOverlayOwnImagePath.description,
        )}
        htmlFor={sid('overlayImagePath')}
      >
        <Input
          id={sid('overlayImagePath')}
          name="overlayImagePath"
          className={`${settingsFieldClass} w-[340px]`}
          value={config.chatOverlayOwnImagePath}
          onClick={setOverlayPath}
          readOnly
        />
      </SettingRow>
    );
  };

  const setCropX = async (array: number[]) => {
    const value = array[0];
    setConfig((prev) => ({ ...prev, chatOverlayCropX: value }));
    const p = await ipc.getSourcePosition(SceneItem.OVERLAY);
    p.cropLeft = value;
    p.cropRight = value;
    await ipc.setSourcePosition(SceneItem.OVERLAY, p);
  };

  const setCropY = async (array: number[]) => {
    const value = array[0];
    setConfig((prev) => ({ ...prev, chatOverlayCropY: value }));
    const p = await ipc.getSourcePosition(SceneItem.OVERLAY);
    p.cropTop = value;
    p.cropBottom = value;
    await ipc.setSourcePosition(SceneItem.OVERLAY, p);
  };

  const getChatOverlayCropSliders = () => {
    return (
      <>
        <SettingRow
          label={getLocalePhrase(appState.language, Phrase.WidthLabel)}
          help={getLocalePhrase(
            appState.language,
            configSchema.chatOverlayCropX.description,
          )}
          htmlFor={sid('cropX')}
        >
          <div className="flex w-[180px] items-center">
            <Slider
              id={sid('cropX')}
              value={[config.chatOverlayCropX]}
              max={cropMaxX}
              step={1}
              onValueChange={setCropX}
            />
          </div>
        </SettingRow>
        <SettingRow
          label={getLocalePhrase(appState.language, Phrase.HeightLabel)}
          help={getLocalePhrase(
            appState.language,
            configSchema.chatOverlayCropY.description,
          )}
          htmlFor={sid('cropY')}
        >
          <div className="flex w-[180px] items-center">
            <Slider
              id={sid('cropY')}
              value={[config.chatOverlayCropY]}
              max={cropMaxY}
              step={1}
              onValueChange={setCropY}
            />
          </div>
        </SettingRow>
      </>
    );
  };

  const showPathWarning =
    config.chatOverlayOwnImage &&
    !config.chatOverlayOwnImagePath.endsWith('.png') &&
    !config.chatOverlayOwnImagePath.endsWith('.gif');

  return (
    <div className="divide-y divide-panel-line">
      {getChatOverlayEnabledSwitch()}
      {config.chatOverlayEnabled && getChatOverlayOwnImageSwitch()}
      {config.chatOverlayEnabled &&
        config.chatOverlayOwnImage &&
        getOwnImagePathField()}
      {showPathWarning && (
        <p className="m-0 px-[18px] py-3.5 text-sm text-error-text">
          {getLocalePhrase(appState.language, Phrase.ErrorCustomImageFileType)}
        </p>
      )}
      {config.chatOverlayEnabled && getChatOverlayCropSliders()}
    </div>
  );
};

export default ChatOverlayControls;
