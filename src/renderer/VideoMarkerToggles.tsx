import { VideoCategory } from 'types/VideoCategory';
import { useEffect, useRef } from 'react';
import { ConfigurationSchema } from 'config/configSchema';
import { AppState, DeathMarkers } from 'main/types';
import { setConfigValues } from './useSettings';
import {
  convertNumToDeathMarkers,
  convertDeathMarkersToNum,
} from './rendererutils';
import { Segmented } from './logs/Segmented';

interface IProps {
  config: ConfigurationSchema;
  setConfig: React.Dispatch<React.SetStateAction<ConfigurationSchema>>;
  category: VideoCategory;
  appState?: AppState;
}

const VideoMarkerToggles = (props: IProps) => {
  const initialRender = useRef(true);
  const { category, config, setConfig } = props;
  const deathMarkers = convertNumToDeathMarkers(config.deathMarkers);

  useEffect(() => {
    // Don't fire on the initial render.
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    setConfigValues({
      deathMarkers: config.deathMarkers,
      encounterMarkers: config.encounterMarkers,
    });
  }, [config.deathMarkers, config.encounterMarkers]);

  const setDeaths = (value: DeathMarkers) => {
    setConfig((prevState) => {
      return {
        ...prevState,
        deathMarkers: convertDeathMarkersToNum(value),
      };
    });
  };

  const setEncounterMarkers = (value: string) => {
    const isTrue = value === 'true';
    setConfig((prevState) => {
      return {
        ...prevState,
        encounterMarkers: isTrue,
      };
    });
  };

  const renderDeathSelection = () => {
    return (
      <Segmented
        tall
        label="Show deaths"
        value={deathMarkers}
        onChange={setDeaths}
        items={[
          {
            key: DeathMarkers.ALL,
            label: 'All deaths',
            title: 'Mark every death on the timeline',
          },
          {
            key: DeathMarkers.OWN,
            label: 'Mine',
            title: 'Mark only your own deaths on the timeline',
          },
          {
            key: DeathMarkers.NONE,
            label: 'None',
            title: 'No death marks on the timeline',
          },
        ]}
      />
    );
  };

  const renderEncounterSelection = () => {
    return (
      <Segmented
        tall
        label="Show encounters"
        value={config.encounterMarkers ? 'on' : 'off'}
        onChange={(key) => setEncounterMarkers(key === 'on' ? 'true' : 'false')}
        items={[
          {
            key: 'on',
            label: 'Encounters on',
            title: 'Mark boss fights on the timeline',
          },
          {
            key: 'off',
            label: 'Off',
            title: 'No boss fight marks on the timeline',
          },
        ]}
      />
    );
  };

  return (
    <>
      {renderDeathSelection()}
      {category === VideoCategory.MythicPlus && renderEncounterSelection()}
    </>
  );
};

export default VideoMarkerToggles;
