import { AppState, RendererVideo, StorageFilter } from 'main/types';
import { Dispatch, SetStateAction } from 'react';
import { Segmented } from './logs/Segmented';
import { getLocalePhrase } from 'localisation/translations';
import { Phrase } from 'localisation/phrases';

interface IProps {
  appState: AppState;
  setAppState: Dispatch<SetStateAction<AppState>>;
  categoryState: RendererVideo[];
}

const StorageFilterToggle = (props: IProps) => {
  const { appState, setAppState, categoryState } = props;
  const { storageFilter, language } = appState;

  const hasDisk = categoryState.filter((rv) => !rv.cloud).length > 0;
  const hasCloud = categoryState.filter((rv) => rv.cloud).length > 0;

  const setStorageFilter = (storageFilter: StorageFilter) => {
    if (!storageFilter) {
      // Don't allow the user to toggle this off.
      return;
    }

    setAppState((prevState) => ({
      ...prevState,
      storageFilter,
    }));
  };

  return (
    <Segmented
      tall
      label="Storage filter"
      value={storageFilter}
      onChange={setStorageFilter}
      items={[
        {
          key: StorageFilter.BOTH,
          label: 'All',
          title: getLocalePhrase(language, Phrase.ShowBothTooltip),
        },
        {
          key: StorageFilter.DISK,
          label: 'This PC',
          title: getLocalePhrase(language, Phrase.ShowDiskOnlyTooltip),
          disabled: !hasDisk,
        },
        {
          key: StorageFilter.CLOUD,
          label: 'Cloud',
          title: getLocalePhrase(language, Phrase.ShowCloudOnlyTooltip),
          disabled: !hasCloud,
        },
      ]}
    />
  );
};

export default StorageFilterToggle;
