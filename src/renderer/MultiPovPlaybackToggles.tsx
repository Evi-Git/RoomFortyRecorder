import { AppState, RendererVideo } from 'main/types';
import { Segmented } from './logs/Segmented';
import { LayoutGrid, TvMinimal } from 'lucide-react';

interface IProps {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  allowMultiPlayer: boolean;
  opts: RendererVideo[];
}

const MultiPovPlaybackToggles = (props: IProps) => {
  const { appState, setAppState, allowMultiPlayer, opts } = props;
  const { selectedVideos, multiPlayerMode } = appState;

  const onValueChange = (value: string) => {
    let s = [...selectedVideos];

    if (value === 'true') {
      // User has selected multi player mode. Fill up to 2 slots
      s = opts.slice(0, 2);
    } else {
      // Remove all but the first selected video now that we're switching out
      // of multiPlayerMode.
      s = s.slice(0, 1);
    }

    setAppState((prevState) => {
      return {
        ...prevState,
        multiPlayerMode: value === 'true',
        viewpointSelectionOpen: value === 'true',
        selectedVideos: s,
      };
    });
  };

  return (
    <Segmented
      tall
      label="Player mode"
      value={multiPlayerMode ? 'multi' : 'single'}
      onChange={(key) => {
        // Clicking the active option does nothing.
        if ((key === 'multi') === multiPlayerMode) return;
        onValueChange(key === 'multi' ? 'true' : 'false');
      }}
      items={[
        {
          key: 'single',
          label: <TvMinimal size={16} />,
          title: 'One viewpoint at a time',
        },
        {
          key: 'multi',
          label: <LayoutGrid size={16} />,
          title: allowMultiPlayer
            ? 'Several viewpoints side by side'
            : 'Needs a recording with more than one viewpoint',
          disabled: !allowMultiPlayer,
        },
      ]}
    />
  );
};

export default MultiPovPlaybackToggles;
