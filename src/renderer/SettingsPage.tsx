import React, { Dispatch, SetStateAction, useState } from 'react';
import {
  CombatLoggingStatus,
  AppState,
  RecStatus,
  RendererVideo,
} from 'main/types';
import { ConfigurationSchema } from 'config/configSchema';
import { getLocalePhrase } from 'localisation/translations';
import GeneralSettings from './GeneralSettings';
import FlavourSettings from './FlavourSettings';
import PVESettings from './PVESettings';
import CloudSettings from './CloudSettings';
import { PageHeader } from './components/PageHeader/PageHeader';
import { ScrollArea } from './components/ScrollArea/ScrollArea';
import LocaleSettings from './LocaleSettings';
import WindowsSettings from './WindowsSettings';
import { Phrase } from 'localisation/phrases';
import ManualSettings from './ManualSettings';

interface IProps {
  recorderStatus: RecStatus;
  config: ConfigurationSchema;
  setConfig: Dispatch<SetStateAction<ConfigurationSchema>>;
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  combatLoggingStatus: CombatLoggingStatus;
  videoState: RendererVideo[];
}

type SettingsTab = 'application' | 'game' | 'pro';

const SettingsPage: React.FC<IProps> = (props: IProps) => {
  const {
    recorderStatus,
    config,
    setConfig,
    appState,
    setAppState,
    combatLoggingStatus,
    videoState,
  } = props;
  const { language } = appState;
  const [tab, setTab] = useState<SettingsTab>('application');

  return (
    <div className="w-full h-full bg-background-higher pt-[32px]">
      <ScrollArea
        withScrollIndicators={false}
        className="h-[calc(100svh-32px)]"
      >
        <div className="mx-auto flex max-w-[880px] flex-col gap-y-[22px] px-7 py-6 pb-10">
          <PageHeader<SettingsTab>
            title={getLocalePhrase(language, Phrase.SettingsHeading)}
            tabsLabel="Settings sections"
            tab={tab}
            onTab={setTab}
            tabs={[
              {
                key: 'application',
                label: getLocalePhrase(
                  language,
                  Phrase.SettingsPageApplicationHeader,
                ),
              },
              {
                key: 'game',
                label: getLocalePhrase(language, Phrase.SettingsPageGameHeader),
              },
              {
                key: 'pro',
                label: getLocalePhrase(language, Phrase.CloudSettingsLabel),
              },
            ]}
          />

          {tab === 'application' && (
            <>
              <GeneralSettings
                recorderStatus={recorderStatus}
                appState={appState}
              />
              <WindowsSettings
                appState={appState}
                config={config}
                setConfig={setConfig}
              />
              <LocaleSettings
                config={config}
                setConfig={setConfig}
                appState={appState}
                setAppState={setAppState}
              />
            </>
          )}

          {tab === 'game' && (
            <>
              <FlavourSettings
                recorderStatus={recorderStatus}
                config={config}
                setConfig={setConfig}
                appState={appState}
                combatLoggingStatus={combatLoggingStatus}
              />
              <PVESettings appState={appState} />
              <ManualSettings
                appState={appState}
                config={config}
                setConfig={setConfig}
              />
            </>
          )}

          {tab === 'pro' && (
            <CloudSettings
              appState={appState}
              config={config}
              setConfig={setConfig}
              videoState={videoState}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default SettingsPage;
