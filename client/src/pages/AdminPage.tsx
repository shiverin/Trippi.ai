import {
  Bell,
  Briefcase,
  Bug,
  Database,
  FileText,
  GitBranch,
  KeyRound,
  Map,
  Puzzle,
  ScrollText,
  Settings as SettingsIcon,
  Shield,
  SlidersHorizontal,
  UserCog,
  Users,
} from 'lucide-react';
import React from 'react';
import { adminApi } from '../api/client';
import AddonManager from '../components/Admin/AddonManager';
import AdminMcpTokensPanel from '../components/Admin/AdminMcpTokensPanel';
import AuditLogPanel from '../components/Admin/AuditLogPanel';
import BackupPanel from '../components/Admin/BackupPanel';
import CategoryManager from '../components/Admin/CategoryManager';
import DefaultUserSettingsTab from '../components/Admin/DefaultUserSettingsTab';
import DevNotificationsPanel from '../components/Admin/DevNotificationsPanel';
import GitHubPanel from '../components/Admin/GitHubPanel';
import PackingTemplateManager from '../components/Admin/PackingTemplateManager';
import PageShell from '../components/Layout/PageShell';
import PageSidebar, { type PageSidebarTab } from '../components/Layout/PageSidebar';
import { useTranslation } from '../i18n';
import AdminNotificationsTab from './admin/AdminNotificationsTab';
import AdminSettingsTab from './admin/AdminSettingsTab';
import AdminStatCard from './admin/AdminStatCard';
import AdminUpdateBanner from './admin/AdminUpdateBanner';
import AdminUserModals from './admin/AdminUserModals';
import AdminUsersTab from './admin/AdminUsersTab';
import { useAdmin } from './admin/useAdmin';

export default function AdminPage(): React.ReactElement {
  const { t, locale } = useTranslation();
  // Page = wiring container: all admin data slices + handlers live in the hook,
  // each tab/section renders from a dedicated sub-component.
  const admin = useAdmin();
  const {
    demoMode,
    mcpEnabled,
    devMode,
    toast,
    activeTab,
    setActiveTab,
    stats,
    bagTrackingEnabled,
    setBagTrackingEnabled,
    collabFeatures,
    setCollabFeatures,
    serverTimezone,
    updateInfo,
    setShowUpdateModal,
  } = admin;

  const TABS: PageSidebarTab[] = [
    { id: 'users', label: t('admin.tabs.users'), icon: Users },
    { id: 'config', label: t('admin.tabs.config'), icon: SlidersHorizontal },
    { id: 'defaults', label: t('admin.tabs.defaults'), icon: UserCog },
    { id: 'addons', label: t('admin.tabs.addons'), icon: Puzzle },
    { id: 'settings', label: t('admin.tabs.settings'), icon: SettingsIcon },
    { id: 'notifications', label: t('admin.tabs.notifications'), icon: Bell },
    { id: 'backup', label: t('admin.tabs.backup'), icon: Database },
    { id: 'audit', label: t('admin.tabs.audit'), icon: ScrollText },
    ...(mcpEnabled ? [{ id: 'mcp-tokens', label: t('admin.tabs.mcpTokens'), icon: KeyRound }] : []),
    { id: 'github', label: t('admin.tabs.github'), icon: GitBranch },
    ...(devMode ? [{ id: 'dev-notifications', label: 'Dev: Notifications', icon: Bug }] : []),
  ];

  return (
    <PageShell background="var(--bg-secondary)">
      <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
            <Shield className="h-5 w-5 text-slate-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('admin.title')}</h1>
            <p className="text-sm text-slate-500">{t('admin.subtitle')}</p>
          </div>
        </div>

        {/* Update Banner */}
        {updateInfo && <AdminUpdateBanner updateInfo={updateInfo} t={t} onHowTo={() => setShowUpdateModal(true)} />}

        {/* Demo Baseline Button */}
        {demoMode && (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div>
              <p className="text-sm font-semibold text-amber-900">Demo Baseline</p>
              <p className="text-xs text-amber-700">
                Save current state as the hourly reset point. All admin trips and settings will be preserved.
              </p>
            </div>
            <button
              onClick={async () => {
                try {
                  await adminApi.saveDemoBaseline();
                  toast.success('Baseline saved! Resets will restore to this state.');
                } catch (e) {
                  toast.error(e.response?.data?.error || 'Failed to save baseline');
                }
              }}
              className="ml-4 flex-shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
            >
              Save Baseline
            </button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: t('admin.stats.users'), value: stats.totalUsers, icon: Users },
              { label: t('admin.stats.trips'), value: stats.totalTrips, icon: Briefcase },
              { label: t('admin.stats.places'), value: stats.totalPlaces, icon: Map },
              { label: t('admin.stats.files'), value: stats.totalFiles || 0, icon: FileText },
            ].map(({ label, value, icon: Icon }) => (
              <AdminStatCard key={label} label={label} value={value} icon={Icon} />
            ))}
          </div>
        )}

        {/* Sidebar layout — nav on the left, active panel on the right */}
        <PageSidebar
          sidebarLabel={t('admin.title').toUpperCase()}
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          footer="admin · self-hosted"
        >
          {/* Tab content */}
          {activeTab === 'users' && <AdminUsersTab admin={admin} t={t} locale={locale} />}

          {activeTab === 'config' && (
            <div className="space-y-6">
              <PackingTemplateManager />
              <CategoryManager />
            </div>
          )}

          {activeTab === 'addons' && (
            <div className="space-y-6">
              <AddonManager
                bagTrackingEnabled={bagTrackingEnabled}
                onToggleBagTracking={async () => {
                  const next = !bagTrackingEnabled;
                  setBagTrackingEnabled(next);
                  try {
                    await adminApi.updateBagTracking(next);
                  } catch {
                    setBagTrackingEnabled(!next);
                  }
                }}
                collabFeatures={collabFeatures}
                onToggleCollabFeature={async (key: string) => {
                  const next = { ...collabFeatures, [key]: !collabFeatures[key] };
                  setCollabFeatures(next);
                  try {
                    await adminApi.updateCollabFeatures({ [key]: next[key] });
                  } catch {
                    setCollabFeatures(collabFeatures);
                  }
                }}
              />
            </div>
          )}

          {activeTab === 'settings' && <AdminSettingsTab admin={admin} t={t} />}

          {activeTab === 'notifications' && <AdminNotificationsTab admin={admin} t={t} />}

          {activeTab === 'backup' && <BackupPanel />}

          {activeTab === 'audit' && <AuditLogPanel serverTimezone={serverTimezone} />}

          {activeTab === 'mcp-tokens' && <AdminMcpTokensPanel />}

          {activeTab === 'github' && <GitHubPanel isPrerelease={updateInfo?.is_prerelease ?? false} />}

          {activeTab === 'defaults' && <DefaultUserSettingsTab />}

          {activeTab === 'dev-notifications' && <DevNotificationsPanel />}
        </PageSidebar>
      </div>

      <AdminUserModals admin={admin} t={t} />
    </PageShell>
  );
}
