import { lazy, ReactNode, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { authApi } from './api/client';
import BottomNav from './components/Layout/BottomNav';
import OfflineBanner from './components/Layout/OfflineBanner';
import { ToastContainer } from './components/shared/Toast';
import { SystemNoticeHost } from './components/SystemNotices/SystemNoticeHost.js';
import { useInAppNotificationListener } from './hooks/useInAppNotificationListener.ts';
import { TranslationProvider, useTranslation } from './i18n';
import DashboardPage from './pages/DashboardPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import JourneyPublicPage from './pages/JourneyPublicPage';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import OAuthAuthorizePage from './pages/OAuthAuthorizePage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SharedTripPage from './pages/SharedTripPage';
import { useAddonStore } from './store/addonStore';
import { useAuthStore } from './store/authStore';
import { PermissionLevel, usePermissionsStore } from './store/permissionsStore';
import { useSettingsStore } from './store/settingsStore';
import { registerSyncTriggers, unregisterSyncTriggers } from './sync/syncTriggers';
// Notice action registrations (side-effect imports):
import './pages/Trips/noticeActions.js';

const AdminPage = lazy(() => import('./pages/AdminPage'));
const AtlasPage = lazy(() => import('./pages/AtlasPage'));
const FilesPage = lazy(() => import('./pages/FilesPage'));
const FriendsPage = lazy(() => import('./pages/FriendsPage'));
const InAppNotificationsPage = lazy(() => import('./pages/InAppNotificationsPage.tsx'));
const JourneyDetailPage = lazy(() => import('./pages/JourneyDetailPage'));
const JourneyPage = lazy(() => import('./pages/JourneyPage'));
const McpConnectPage = lazy(() => import('./pages/McpConnectPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TripPlannerPage = lazy(() => import('./pages/TripPlannerPage'));
const VacayPage = lazy(() => import('./pages/VacayPage'));

interface ProtectedRouteProps {
  children: ReactNode;
  adminRequired?: boolean;
  addonId?: string;
}

function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900"></div>
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      </div>
    </div>
  );
}

function DeferredRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function ProtectedRoute({ children, adminRequired = false, addonId }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const appRequireMfa = useAuthStore((s) => s.appRequireMfa);
  const addonStore = useAddonStore();
  const { t } = useTranslation();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900"></div>
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    const redirectParam = encodeURIComponent(location.pathname + location.search + location.hash);
    return <Navigate to={`/login?redirect=${redirectParam}`} replace />;
  }

  if (appRequireMfa && user && !user.mfa_enabled && location.pathname !== '/settings') {
    return <Navigate to="/settings?mfa=required" replace />;
  }

  if (adminRequired && user && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (addonId && addonStore.loaded && !addonStore.isEnabled(addonId)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex h-screen flex-col md:block md:h-auto">
      <div className="flex-1 overflow-y-auto md:overflow-visible">{children}</div>
      <BottomNav />
    </div>
  );
}

function RootRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900"></div>
      </div>
    );
  }

  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <LandingPage />;
}

export default function App() {
  const {
    loadUser,
    isAuthenticated,
    demoMode,
    setDemoMode,
    setOverlaysDisabled,
    setDevMode,
    setIsPrerelease,
    setAppVersion,
    setHasMapsKey,
    setServerTimezone,
    setAppRequireMfa,
    setTripRemindersEnabled,
    setPlacesPhotosEnabled,
    setPlacesAutocompleteEnabled,
    setPlacesDetailsEnabled,
  } = useAuthStore();
  const { loadSettings } = useSettingsStore();
  const { loadAddons } = useAddonStore();

  useEffect(() => {
    if (
      !location.pathname.startsWith('/shared/') &&
      !location.pathname.startsWith('/public/') &&
      !location.pathname.startsWith('/login')
    ) {
      // If the persist snapshot already has an authenticated user, validate
      // silently so the PWA shell renders immediately without a spinner.
      const alreadyAuthenticated = useAuthStore.getState().isAuthenticated;
      if (alreadyAuthenticated) {
        useAuthStore.setState({ isLoading: false });
        loadUser({ silent: true });
      } else {
        loadUser();
      }
    }
    authApi
      .getAppConfig()
      .then(
        async (config: {
          demo_mode?: boolean;
          disable_overlays?: boolean;
          dev_mode?: boolean;
          is_prerelease?: boolean;
          has_maps_key?: boolean;
          version?: string;
          timezone?: string;
          require_mfa?: boolean;
          trip_reminders_enabled?: boolean;
          places_photos_enabled?: boolean;
          places_autocomplete_enabled?: boolean;
          places_details_enabled?: boolean;
          permissions?: Record<string, PermissionLevel>;
        }) => {
          setDemoMode(!!config?.demo_mode);
          setOverlaysDisabled(!!config?.disable_overlays);
          if (config?.dev_mode) setDevMode(true);
          if (config?.is_prerelease !== undefined) setIsPrerelease(config.is_prerelease);
          if (config?.version) setAppVersion(config.version);
          if (config?.has_maps_key !== undefined) setHasMapsKey(config.has_maps_key);
          if (config?.timezone) setServerTimezone(config.timezone);
          if (config?.require_mfa !== undefined) setAppRequireMfa(!!config.require_mfa);
          if (config?.trip_reminders_enabled !== undefined) setTripRemindersEnabled(config.trip_reminders_enabled);
          if (config?.places_photos_enabled !== undefined) setPlacesPhotosEnabled(config.places_photos_enabled);
          if (config?.places_autocomplete_enabled !== undefined)
            setPlacesAutocompleteEnabled(config.places_autocomplete_enabled);
          if (config?.places_details_enabled !== undefined) setPlacesDetailsEnabled(config.places_details_enabled);
          if (config?.permissions) usePermissionsStore.getState().setPermissions(config.permissions);

          if (config?.version) {
            const storedVersion = localStorage.getItem('trek_app_version');
            if (storedVersion && storedVersion !== config.version) {
              try {
                if ('caches' in window) {
                  const names = await caches.keys();
                  await Promise.all(names.map((n) => caches.delete(n)));
                }
                if ('serviceWorker' in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(regs.map((r) => r.unregister()));
                }
              } catch {}
              localStorage.setItem('trek_app_version', config.version);
              window.location.reload();
              return;
            }
            localStorage.setItem('trek_app_version', config.version);
          }
        }
      )
      .catch(() => {});
  }, []);

  const { settings } = useSettingsStore();

  useInAppNotificationListener();

  useEffect(() => {
    if (isAuthenticated) {
      loadSettings();
      loadAddons();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    registerSyncTriggers();
    return () => unregisterSyncTriggers();
  }, []);

  const location = useLocation();
  const isSharedPage = location.pathname.startsWith('/shared/');

  useEffect(() => {
    // Shared page always forces light mode
    if (isSharedPage) {
      document.documentElement.classList.remove('dark');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#ffffff');
      return;
    }

    const mode = settings.dark_mode;
    const applyDark = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', isDark ? '#09090b' : '#ffffff');
    };

    if (mode === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyDark(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyDark(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    applyDark(mode === true || mode === 'dark');
  }, [settings.dark_mode, isSharedPage]);

  const isAuthPage =
    location.pathname.startsWith('/login') ||
    location.pathname.startsWith('/register') ||
    location.pathname.startsWith('/forgot-password') ||
    location.pathname.startsWith('/reset-password');
  const isLandingPage = location.pathname === '/';

  return (
    <TranslationProvider>
      {!isAuthPage && !isLandingPage && <SystemNoticeHost />}
      <ToastContainer />
      {!isLandingPage && <OfflineBanner />}
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/shared/:token" element={<SharedTripPage />} />
        <Route path="/public/journey/:token" element={<JourneyPublicPage />} />
        <Route path="/register" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* OAuth 2.1 consent page — intentionally outside ProtectedRoute */}
        <Route path="/oauth/consent" element={<OAuthAuthorizePage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips/:id"
          element={
            <ProtectedRoute>
              <DeferredRoute>
                <TripPlannerPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/trips/:id/files"
          element={
            <ProtectedRoute>
              <DeferredRoute>
                <FilesPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute adminRequired>
              <DeferredRoute>
                <AdminPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <DeferredRoute>
                <SettingsPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/mcp-connect"
          element={
            <ProtectedRoute addonId="mcp">
              <DeferredRoute>
                <McpConnectPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/vacay"
          element={
            <ProtectedRoute>
              <DeferredRoute>
                <VacayPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/atlas"
          element={
            <ProtectedRoute>
              <DeferredRoute>
                <AtlasPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/friends"
          element={
            <ProtectedRoute>
              <DeferredRoute>
                <FriendsPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/journey"
          element={
            <ProtectedRoute addonId="journey">
              <DeferredRoute>
                <JourneyPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/journey/:id"
          element={
            <ProtectedRoute addonId="journey">
              <DeferredRoute>
                <JourneyDetailPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <DeferredRoute>
                <InAppNotificationsPage />
              </DeferredRoute>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TranslationProvider>
  );
}
