import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Bot,
  Briefcase,
  CalendarDays,
  ChevronDown,
  Compass,
  Gift,
  Globe,
  LogOut,
  Moon,
  Settings,
  Shield,
  Sun,
  Users,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDocumentDarkMode } from '../../hooks/useDocumentDarkMode';
import { useEntitlements } from '../../hooks/useEntitlements';
import { useTranslation } from '../../i18n';
import { useAddonStore } from '../../store/addonStore';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import PlanStatusBadge from '../Billing/PlanStatusBadge';
import ReferralDialog from '../Referrals/ReferralDialog';
import { useToast } from '../shared/Toast';
import InAppNotificationBell from './InAppNotificationBell.tsx';

const ADDON_ICONS: Record<string, LucideIcon> = { CalendarDays, Briefcase, Globe, Users, Compass };

interface NavbarProps {
  tripTitle?: string;
  tripId?: number | string;
  onBack?: () => void;
  showBack?: boolean;
  onShare?: () => void;
}

interface Addon {
  id: string;
  name: string;
  icon: string;
  type: string;
  enabled: boolean;
}

export default function Navbar({ tripTitle, tripId, onBack, showBack, onShare }: NavbarProps): React.ReactElement {
  const { user, logout, isPrerelease, appVersion } = useAuthStore();
  const { settings, updateSetting } = useSettingsStore();
  const { addons: allAddons, loadAddons } = useAddonStore();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);
  const [referralDialogOpen, setReferralDialogOpen] = useState<boolean>(false);
  const [scrolled, setScrolled] = useState<boolean>(false);
  const documentDark = useDocumentDarkMode();
  const entitlementState = useEntitlements();
  const darkMode = settings.dark_mode;
  const settingDark =
    darkMode === true ||
    darkMode === 'dark' ||
    (darkMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = documentDark || settingDark;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8 || (document.body.scrollTop || 0) > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.body.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Only show 'global' type addons in the navbar — 'integration' addons have no dedicated page
  const globalAddons = allAddons.filter((a: Addon) => a.type === 'global' && a.enabled);
  const mcpConnectEnabled = allAddons.some((a: Addon) => a.id === 'mcp' && a.enabled);

  useEffect(() => {
    if (user) loadAddons();
  }, [user, location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login', { state: { noRedirect: true } });
  };

  // Keep track of the pending theme-transition cleanup so we can cancel it
  // on unmount. Without this the timer fires after jsdom teardown in unit
  // tests (document is gone) and triggers an unhandled ReferenceError that
  // trips vitest's exit code.
  const themeTransitionTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (themeTransitionTimer.current !== null) {
        window.clearTimeout(themeTransitionTimer.current);
        themeTransitionTimer.current = null;
      }
    },
    []
  );

  const toggleDarkMode = () => {
    document.documentElement.classList.add('trek-theme-transitioning');
    void updateSetting('dark_mode', dark ? 'light' : 'dark').catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    });
    if (themeTransitionTimer.current !== null) window.clearTimeout(themeTransitionTimer.current);
    themeTransitionTimer.current = window.setTimeout(() => {
      document.documentElement.classList.remove('trek-theme-transitioning');
      themeTransitionTimer.current = null;
    }, 360);
  };

  const getAddonName = (addon: Addon): string => {
    const key = `admin.addons.catalog.${addon.id}.name`;
    const translated = t(key);
    return translated !== key ? translated : addon.name;
  };

  return (
    <nav
      style={{
        background: dark
          ? scrolled
            ? 'rgba(9,9,11,0.78)'
            : 'rgba(9,9,11,0.95)'
          : scrolled
            ? 'rgba(255,255,255,0.72)'
            : 'rgba(255,255,255,0.95)',
        backdropFilter: scrolled ? 'blur(28px) saturate(180%)' : 'blur(20px)',
        WebkitBackdropFilter: scrolled ? 'blur(28px) saturate(180%)' : 'blur(20px)',
        borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
        boxShadow: scrolled
          ? dark
            ? '0 4px 24px rgba(0,0,0,0.35)'
            : '0 4px 24px rgba(0,0,0,0.08)'
          : dark
            ? '0 1px 12px rgba(0,0,0,0.2)'
            : '0 1px 12px rgba(0,0,0,0.05)',
        touchAction: 'manipulation',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        height: 'var(--nav-h)',
        transition:
          'background 240ms cubic-bezier(0.23,1,0.32,1), backdrop-filter 240ms cubic-bezier(0.23,1,0.32,1), box-shadow 240ms cubic-bezier(0.23,1,0.32,1)',
      }}
      className="fixed left-0 right-0 top-0 z-[200] hidden items-center gap-4 px-4 md:flex"
    >
      {/* Left side */}
      <div className="flex min-w-0 items-center gap-3">
        {showBack && (
          <button
            onClick={onBack}
            className="trek-back-btn flex flex-shrink-0 items-center gap-1.5 rounded-lg p-1.5 text-sm text-content-muted transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <ArrowLeft className="trek-back-icon h-4 w-4" />
            <span className="hidden sm:inline">{t('common.back')}</span>
          </button>
        )}

        <Link
          to="/dashboard"
          aria-label="trippi dashboard"
          className="flex flex-shrink-0 items-center gap-2 transition-colors"
        >
          <img
            src={dark ? '/brand/trippi-icon-light.png' : '/brand/trippi-icon.png'}
            alt=""
            className="brand-icon"
            style={{ height: 28, width: 28 }}
          />
          <span
            className="hidden sm:inline"
            style={{
              color: dark ? '#f8fafc' : '#0f2a56',
              fontSize: 28,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: 0,
            }}
          >
            trippi
          </span>
        </Link>

        {tripTitle && (
          <>
            <span className="hidden text-content-faint sm:inline">/</span>
            <span className="hidden max-w-48 truncate text-sm font-medium text-content-muted sm:inline">
              {tripTitle}
            </span>
          </>
        )}
      </div>

      {/* Centred liquid-glass tab menu (design handoff). Absolutely positioned so
          the left brand block and the right action cluster keep their layout. */}
      {globalAddons.length > 0 && !tripTitle && (
        <div
          className="trippi-nav-pill"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            gap: 4,
            padding: 4,
            borderRadius: 14,
            background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'}`,
          }}
        >
          {[
            { id: '__trips', path: '/dashboard', label: t('nav.myTrips'), Icon: Briefcase },
            ...globalAddons.map((a) => ({
              id: a.id,
              path: `/${a.id}`,
              label: getAddonName(a),
              Icon: ADDON_ICONS[a.icon] || CalendarDays,
            })),
          ].map((tab) => {
            const isActive = location.pathname === tab.path;
            return (
              <Link
                key={tab.id}
                to={tab.path}
                className="flex items-center gap-1.5 transition-colors"
                style={{
                  padding: '5px 16px',
                  borderRadius: 9,
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: isActive ? 'var(--bg-card)' : 'transparent',
                  boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.05)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                <tab.Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Share button */}
      {onShare && (
        <button
          onClick={onShare}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface-card px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
        >
          <Users className="h-4 w-4" />
          <span className="hidden sm:inline">{t('nav.share')}</span>
        </button>
      )}

      {/* Prerelease badge */}
      {isPrerelease && appVersion && (
        <span className="hidden flex-shrink-0 items-center gap-1.5 rounded-full border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[#d97706] sm:flex">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#f59e0b]" />
          {appVersion}
        </span>
      )}

      {/* Dark mode toggle (light ↔ dark, overrides auto) — hidden on mobile */}
      <button
        onClick={toggleDarkMode}
        title={dark ? t('nav.lightMode') : t('nav.darkMode')}
        className="relative hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg p-2 text-content-muted transition-colors sm:flex"
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <Sun
          className="absolute h-4 w-4 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ opacity: dark ? 1 : 0, transform: dark ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.6)' }}
        />
        <Moon
          className="absolute h-4 w-4 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ opacity: dark ? 0 : 1, transform: dark ? 'rotate(90deg) scale(0.6)' : 'rotate(0deg) scale(1)' }}
        />
      </button>

      {/* Notification bell — only in trip view on mobile, everywhere on desktop */}
      {user && tripId && <InAppNotificationBell />}
      {user && !tripId && (
        <span className="hidden sm:block">
          <InAppNotificationBell />
        </span>
      )}

      {/* User menu */}
      {user && (
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: dark ? '#e2e8f0' : '#111827', color: dark ? '#0f172a' : '#ffffff' }}
              >
                {user.username?.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="hidden max-w-24 truncate text-sm text-content-secondary sm:inline">{user.username}</span>
            <ChevronDown className="h-4 w-4 text-content-faint" />
          </button>

          {userMenuOpen &&
            ReactDOM.createPortal(
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setUserMenuOpen(false)} />
                <div
                  className="trek-menu-enter w-52 overflow-hidden rounded-xl border border-edge bg-surface-card shadow-xl"
                  style={{ position: 'fixed', top: 'var(--nav-h)', right: 8, zIndex: 9999 }}
                >
                  <div className="border-b border-edge-secondary px-4 py-3">
                    <p className="text-sm font-medium text-content">{user.username}</p>
                    <p className="truncate text-xs text-content-muted">{user.email}</p>
                    {user.role === 'admin' && (
                      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-content-secondary">
                        <Shield className="h-3 w-3" /> {t('nav.administrator')}
                      </span>
                    )}
                  </div>
                  <div className="border-b border-edge-secondary p-3">
                    <PlanStatusBadge
                      access={entitlementState.access}
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/settings?tab=usage');
                      }}
                    />
                  </div>

                  <div className="py-1">
                    <Link
                      to="/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-content-secondary transition-colors"
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Settings className="h-4 w-4" />
                      {t('nav.settings')}
                    </Link>

                    {mcpConnectEnabled && (
                      <Link
                        to="/mcp-connect"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-content-secondary transition-colors"
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Bot className="h-4 w-4" />
                        {t('nav.mcpConnect')}
                      </Link>
                    )}

                    {user.role === 'admin' && (
                      <Link
                        to="/admin"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-content-secondary transition-colors"
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Shield className="h-4 w-4" />
                        {t('nav.admin')}
                      </Link>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setReferralDialogOpen(true);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-content-secondary transition-colors"
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Gift className="h-4 w-4" />
                      {t('nav.referFriends')}
                    </button>
                  </div>

                  <div className="border-t border-edge-secondary py-1">
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10"
                    >
                      <LogOut className="h-4 w-4" />
                      {t('nav.logout')}
                    </button>
                  </div>
                </div>
              </>,
              document.body
            )}
        </div>
      )}
      <ReferralDialog open={referralDialogOpen} onClose={() => setReferralDialogOpen(false)} />
    </nav>
  );
}
