import { Bell, CloudOff, Info, Map, Palette, Plug, Settings, User } from 'lucide-react';
import React from 'react';
import PageShell from '../components/Layout/PageShell';
import PageSidebar, { type PageSidebarTab } from '../components/Layout/PageSidebar';
import AboutTab from '../components/Settings/AboutTab';
import AccountTab from '../components/Settings/AccountTab';
import DisplaySettingsTab from '../components/Settings/DisplaySettingsTab';
import IntegrationsTab from '../components/Settings/IntegrationsTab';
import MapSettingsTab from '../components/Settings/MapSettingsTab';
import NotificationsTab from '../components/Settings/NotificationsTab';
import OfflineTab from '../components/Settings/OfflineTab';
import { useTranslation } from '../i18n';
import { useSettings } from './settings/useSettings';

export default function SettingsPage(): React.ReactElement {
  const { t } = useTranslation();
  // Page = wiring container: addon/version loading + active-tab state in the hook.
  const { hasIntegrations, appVersion, activeTab, setActiveTab } = useSettings();

  const tabs: PageSidebarTab[] = [
    { id: 'display', label: t('settings.tabs.display'), icon: Palette },
    { id: 'map', label: t('settings.tabs.map'), icon: Map },
    { id: 'notifications', label: t('settings.tabs.notifications'), icon: Bell },
    ...(hasIntegrations ? [{ id: 'integrations', label: t('settings.tabs.integrations'), icon: Plug }] : []),
    { id: 'offline', label: t('settings.tabs.offline'), icon: CloudOff },
    { id: 'account', label: t('settings.tabs.account'), icon: User },
    ...(appVersion ? [{ id: 'about', label: t('settings.tabs.about'), icon: Info }] : []),
  ];

  return (
    <PageShell background="var(--bg-secondary)">
      <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-tertiary">
            <Settings className="h-5 w-5 text-content-secondary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-content">{t('settings.title')}</h1>
            <p className="text-sm text-content-muted">{t('settings.subtitle')}</p>
          </div>
        </div>

        {/* Sidebar layout */}
        <PageSidebar
          sidebarLabel={t('settings.title').toUpperCase()}
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          footer={appVersion ? `v${appVersion} · self-hosted` : 'self-hosted'}
        >
          {activeTab === 'display' && <DisplaySettingsTab />}
          {activeTab === 'map' && <MapSettingsTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'integrations' && hasIntegrations && <IntegrationsTab />}
          {activeTab === 'offline' && <OfflineTab />}
          {activeTab === 'account' && <AccountTab />}
          {activeTab === 'about' && appVersion && <AboutTab appVersion={appVersion} />}
        </PageSidebar>
      </div>
    </PageShell>
  );
}
