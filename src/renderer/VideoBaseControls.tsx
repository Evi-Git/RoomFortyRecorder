import {
  Dispatch,
  FC,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, Encoder, RecStatus } from 'main/types';
import { obsResolutions } from 'main/constants';
import { configSchema, ConfigurationSchema } from 'config/configSchema';
import { ESupportedEncoders, QualityPresets } from 'main/obsEnums';
import { Wand } from 'lucide-react';
import { getLocalePhrase } from 'localisation/translations';
import { setConfigValues } from './useSettings';
import {
  encoderFilter,
  isHighRes,
  mapEncoderToString,
  mapStringToEncoder,
  translateQuality,
} from './rendererutils';
import { Segmented } from './logs/Segmented';
import {
  SettingRow,
  settingsButtonClass,
  settingsFieldClass,
  useScopedIds,
} from './components/SettingsCard/SettingsCard';
import { Tooltip } from './components/Tooltip/Tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/Select/Select';
import TextBanner from './components/TextBanner/TextBanner';
import { Phrase } from 'localisation/phrases';
import { Button } from './components/Button/Button';

const ipc = window.electron.ipcRenderer;

const outputResolutions = Object.keys(obsResolutions);
const fpsOptions = [10, 20, 30, 60];

interface IProps {
  recorderStatus: RecStatus;
  appState: AppState;
  setPreviewEnabled: Dispatch<SetStateAction<boolean>>;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
}

/**
 * The video base controls. The distinction here between the controls in
 * VideoSourceControls is that the base controls can't be changed live.
 *
 *   - If we're mid encounter, we can't allow settings changes as we can't
 *     stop/start the recording without ruining the clip.
 *   - If WoW is open, OBS is recording but it's uninteresting footage,
 *     changes are allowed but we will need to restart the recorder.
 *   - Otherwise, let the user do whatever they want.
 */
const VideoBaseControls: FC<IProps> = (props: IProps) => {
  const { recorderStatus, appState, setPreviewEnabled, config, setConfig } =
    props;
  const { language } = appState;
  const sid = useScopedIds();
  const initialRender = useRef(true);
  const highRes = isHighRes(config.obsOutputResolution);
  const [encoders, setEncoders] = useState<Encoder[]>([]);

  // This is the current value the app was launched with.
  const [hardwareAcceleration, setHardwareAcceleration] =
    useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      cancelled = true;
    };

    const getAvailableEncoders = async () => {
      const allEncoders = await ipc.invoke('getEncoders', []);
      if (cancelled) return;

      const availableEncoders = allEncoders
        .filter((s: string) => encoderFilter(s, highRes))
        .map(mapStringToEncoder)
        .sort((a: Encoder, b: Encoder) => a.type < b.type);

      setEncoders(availableEncoders);
    };

    const getHardwareAccel = async () => {
      const value = await ipc.getHardwareAcceleration();
      if (!cancelled) setHardwareAcceleration(value);
    };

    getAvailableEncoders();
    getHardwareAccel();

    // The reset of this effect handles config changes, so if it's the
    // initial render then just return here.
    if (initialRender.current) {
      initialRender.current = false;
      return stop;
    }

    setConfigValues({
      obsOutputResolution: config.obsOutputResolution,
      obsFPS: config.obsFPS,
      obsQuality: config.obsQuality,
      obsRecEncoder: config.obsRecEncoder,
    });

    ipc.reconfigureBase();
    return stop;
  }, [
    config.obsOutputResolution,
    config.obsFPS,
    config.obsQuality,
    config.obsRecEncoder,
    highRes,
  ]);

  const isComponentDisabled = () => {
    const isRecording = recorderStatus === RecStatus.Recording;
    const isOverrunning = recorderStatus === RecStatus.Overrunning;
    return isRecording || isOverrunning;
  };

  const setCanvasResolution = (value: string) => {
    const selectedhighRes = isHighRes(value);

    if (selectedhighRes) {
      setConfig((prevState) => {
        return {
          ...prevState,
          obsOutputResolution: value,
          obsRecEncoder: ESupportedEncoders.OBS_X264,
        };
      });
    } else {
      setConfig((prevState) => {
        return {
          ...prevState,
          obsOutputResolution: value,
        };
      });
    }
  };

  const getCanvasResolutionSelect = () => {
    if (isComponentDisabled()) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.CanvasResolutionLabel)}
        help={getLocalePhrase(
          language,
          configSchema.obsOutputResolution.description,
        )}
        htmlFor={sid('resolution')}
      >
        <Select
          value={config.obsOutputResolution}
          onValueChange={setCanvasResolution}
          onOpenChange={(open) => setPreviewEnabled(!open)}
          disabled={isComponentDisabled()}
        >
          <SelectTrigger
            id={sid('resolution')}
            className={`${settingsFieldClass} w-48`}
          >
            <SelectValue
              placeholder={getLocalePhrase(language, Phrase.SelectResolution)}
            />
          </SelectTrigger>
          <SelectContent side="right" position="popper">
            {outputResolutions.map((resolution) => (
              <SelectItem key={resolution} value={resolution}>
                {resolution}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    );
  };

  const setFPS = (fps: string) => {
    if (fps === null) {
      return;
    }

    setConfig((prevState) => {
      return {
        ...prevState,
        obsFPS: parseInt(fps, 10),
      };
    });
  };

  const getFPSToggle = () => {
    if (isComponentDisabled()) {
      return <></>;
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.FPSLabel)}
        help={getLocalePhrase(language, configSchema.obsFPS.description)}
      >
        <Segmented
          label={getLocalePhrase(language, Phrase.FPSLabel)}
          tall
          value={config.obsFPS.toString()}
          onChange={setFPS}
          items={fpsOptions.map((fpsOption) => ({
            key: fpsOption.toString(),
            label: fpsOption,
          }))}
        />
      </SettingRow>
    );
  };

  const setQuality = (value: string) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        obsQuality: value,
      };
    });
  };

  const getDisabledText = () => {
    if (!isComponentDisabled()) {
      return <></>;
    }

    return (
      <div className="px-[18px] py-3.5">
        <TextBanner>
          {getLocalePhrase(language, Phrase.SettingsDisabledText)}
        </TextBanner>
      </div>
    );
  };

  const getQualitySelect = () => {
    if (isComponentDisabled()) {
      return <></>;
    }

    const options = Object.values(QualityPresets);

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.QualityLabel)}
        help={getLocalePhrase(language, configSchema.obsQuality.description)}
        htmlFor={sid('quality')}
      >
        <Select
          value={config.obsQuality}
          onValueChange={setQuality}
          onOpenChange={(open) => setPreviewEnabled(!open)}
          disabled={isComponentDisabled()}
        >
          <SelectTrigger
            id={sid('quality')}
            className={`${settingsFieldClass} w-48`}
          >
            <SelectValue
              placeholder={getLocalePhrase(language, Phrase.SelectQuality)}
            />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {translateQuality(option, language)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    );
  };

  const setEncoder = (value: string) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        obsRecEncoder: value,
      };
    });
  };

  const autoSelectEncoder = async () => {
    const encoder = await ipc.getSensibleEncoderDefault();
    setConfig((prevState) => {
      return {
        ...prevState,
        obsRecEncoder: encoder,
      };
    });
  };

  const getEncoderSelect = () => {
    if (isComponentDisabled()) {
      return <></>;
    }

    let tooltip = getLocalePhrase(
      language,
      configSchema.obsRecEncoder.description,
    );

    // H264 is always available.
    tooltip += '\n\n';
    tooltip += getLocalePhrase(language, Phrase.CodecDescriptionH264);

    const values = encoders.map((e) => e.value);

    if (
      values.includes(ESupportedEncoders.AMD_H265) ||
      values.includes(ESupportedEncoders.NVENC_H265)
    ) {
      // Include H265 description if it's available.
      tooltip += '\n\n';
      tooltip += getLocalePhrase(language, Phrase.CodecDescriptionH265);
    }

    if (
      values.includes(ESupportedEncoders.AMD_AV1) ||
      values.includes(ESupportedEncoders.NVENC_AV1) ||
      values.includes(ESupportedEncoders.QSV_AV1)
    ) {
      // Include AV1 description if it's available.
      tooltip += '\n\n';
      tooltip += getLocalePhrase(language, Phrase.CodecDescriptionAV1);
    }

    return (
      <SettingRow
        label={getLocalePhrase(language, Phrase.VideoEncoderLabel)}
        help={<span className="whitespace-pre-line">{tooltip}</span>}
        htmlFor={sid('encoder')}
      >
        <Select
          value={config.obsRecEncoder}
          onValueChange={setEncoder}
          onOpenChange={(open) => setPreviewEnabled(!open)}
          disabled={isComponentDisabled()}
        >
          <SelectTrigger
            id={sid('encoder')}
            className={`${settingsFieldClass} w-64`}
          >
            <SelectValue
              placeholder={getLocalePhrase(language, Phrase.SelectEncoder)}
            />
          </SelectTrigger>
          <SelectContent>
            {encoders.map((encoder) => (
              <SelectItem key={encoder.name} value={encoder.value}>
                {mapEncoderToString(encoder, language)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip
          content={getLocalePhrase(language, Phrase.AutoSelectEncoderTooltip)}
          side="right"
        >
          <Button
            variant="ghost"
            className={settingsButtonClass}
            aria-label={getLocalePhrase(
              language,
              Phrase.AutoSelectEncoderTooltip,
            )}
            onClick={autoSelectEncoder}
          >
            <Wand size={16} />
          </Button>
        </Tooltip>
      </SettingRow>
    );
  };

  const getHardwareAccelerationWarning = () => {
    // Show the warning re hardware acceleration if if either the app was
    // launched without it (most likely), or the user has disabled it (less
    // likely, but will cause issues on next app launch).
    const showCodecWarning =
      (!hardwareAcceleration || !config.hardwareAcceleration) &&
      (config.obsRecEncoder === ESupportedEncoders.AMD_H265 ||
        config.obsRecEncoder === ESupportedEncoders.AMD_AV1 ||
        config.obsRecEncoder === ESupportedEncoders.NVENC_H265 ||
        config.obsRecEncoder === ESupportedEncoders.NVENC_AV1 ||
        config.obsRecEncoder === ESupportedEncoders.QSV_AV1);

    if (!showCodecWarning) {
      return <></>;
    }

    return (
      <p className="m-0 px-[18px] py-3.5 text-sm text-error-text">
        {getLocalePhrase(appState.language, Phrase.CodecNeedsHardwareRendering)}
      </p>
    );
  };

  return (
    <div className="divide-y divide-panel-line">
      {getDisabledText()}
      {getFPSToggle()}
      {getCanvasResolutionSelect()}
      {getQualitySelect()}
      {getEncoderSelect()}
      {getHardwareAccelerationWarning()}
    </div>
  );
};

export default VideoBaseControls;
