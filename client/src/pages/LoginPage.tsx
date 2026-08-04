import {
  ChevronDown,
  Eye,
  EyeOff,
  Fingerprint,
  Globe,
  Home,
  KeyRound,
  Lock,
  Mail,
  Plane,
  Shield,
  User,
} from 'lucide-react';
import React from 'react';
import ToggleSwitch from '../components/Settings/ToggleSwitch';
import { SUPPORTED_LANGUAGES, useTranslation } from '../i18n';
import { useLogin } from './login/useLogin';

export default function LoginPage(): React.ReactElement {
  const { t, language } = useTranslation();
  // Page = wiring container: the whole auth surface lives in the useLogin hook.
  const {
    navigate,
    mode,
    setMode,
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    rememberMe,
    setRememberMe,
    showPassword,
    setShowPassword,
    isLoading,
    error,
    setError,
    appConfig,
    inviteToken,
    referralCode,
    referralInfo,
    langDropdownOpen,
    setLangDropdownOpen,
    setLanguageLocal,
    showTakeoff,
    mfaStep,
    setMfaStep,
    mfaToken,
    setMfaToken,
    mfaCode,
    setMfaCode,
    passwordChangeStep,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    noRedirect,
    showRegisterOption,
    oidcOnly,
    handleDemoLogin,
    handleSubmit,
    handlePasskeyLogin,
  } = useLogin();

  const oidcButtonShown = !!(appConfig?.oidc_configured && appConfig?.oidc_login && !oidcOnly);
  const passkeyAvailable = !!(
    appConfig?.passkey_login &&
    appConfig?.passkey_configured &&
    !oidcOnly &&
    mode === 'login' &&
    !mfaStep &&
    !passwordChangeStep
  );
  const showRegisterToggle =
    showRegisterOption && !!appConfig?.has_users && !appConfig?.demo_mode && !passwordChangeStep;
  const reserveRegisterToggle = !passwordChangeStep && (appConfig === null || showRegisterToggle);
  const oidcSignupParams = new URLSearchParams();
  if (inviteToken) oidcSignupParams.set('invite', inviteToken);
  if (referralCode) oidcSignupParams.set('ref', referralCode);
  const oidcSignupQuery = oidcSignupParams.toString() ? `?${oidcSignupParams.toString()}` : '';

  const inputBase: React.CSSProperties = {
    width: '100%',
    padding: '11px 12px 11px 40px',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    color: '#111827',
    background: 'white',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  if (showTakeoff) {
    return (
      <div className="takeoff-overlay" style={{ position: 'fixed', inset: 0, zIndex: 99999, overflow: 'hidden' }}>
        {/* Sky gradient */}
        <div className="takeoff-sky" style={{ position: 'absolute', inset: 0 }} />

        {/* Stars */}
        {Array.from({ length: 60 }, (_, i) => (
          <div
            key={i}
            className="takeoff-star"
            style={{
              position: 'absolute',
              width: Math.random() > 0.7 ? 3 : 1.5,
              height: Math.random() > 0.7 ? 3 : 1.5,
              borderRadius: '50%',
              background: 'white',
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${0.3 + Math.random() * 0.5}s, ${Math.random() * 1}s`,
            }}
          />
        ))}

        {/* Clouds rushing past */}
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="takeoff-cloud"
            style={{
              position: 'absolute',
              width: 120 + i * 40,
              height: 40 + i * 10,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)',
              filter: 'blur(8px)',
              right: -200,
              top: `${25 + i * 12}%`,
              animationDelay: `${0.3 + i * 0.25}s`,
            }}
          />
        ))}

        {/* Speed lines */}
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="takeoff-speedline"
            style={{
              position: 'absolute',
              width: 80 + Math.random() * 120,
              height: 1.5,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
              top: `${10 + Math.random() * 80}%`,
              right: -200,
              animationDelay: `${0.5 + i * 0.12}s`,
            }}
          />
        ))}

        {/* Plane */}
        <div
          className="takeoff-plane"
          style={{ position: 'absolute', left: '50%', bottom: '10%', transform: 'translate(-50%, 0)' }}
        >
          <svg viewBox="0 0 480 120" style={{ width: 200, filter: 'drop-shadow(0 0 20px rgba(255,255,255,0.3))' }}>
            <g fill="white" transform="translate(240,60) rotate(-12)">
              <ellipse cx="0" cy="0" rx="120" ry="12" />
              <path d="M-20,-10 L-60,-55 L-40,-55 L0,-15 Z" />
              <path d="M-20,10 L-60,55 L-40,55 L0,15 Z" />
              <path d="M-100,-5 L-120,-30 L-108,-30 L-90,-8 Z" />
              <path d="M-100,5 L-120,30 L-108,30 L-90,8 Z" />
              <ellipse cx="60" cy="0" rx="18" ry="8" />
            </g>
          </svg>
        </div>

        {/* Contrail */}
        <div
          className="takeoff-trail"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '8%',
            width: 3,
            height: 0,
            background: 'linear-gradient(to top, transparent, rgba(255,255,255,0.5))',
            transformOrigin: 'bottom center',
          }}
        />

        {/* Logo fade in + burst */}
        <div
          className="takeoff-logo"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <img
            src="/brand/trippi-wordmark-light.png"
            alt="trippi.ai"
            className="brand-wordmark"
            style={{ height: 72 }}
          />
          <p
            style={{
              margin: 0,
              fontSize: 20,
              color: 'rgba(255,255,255,0.6)',
              fontFamily: "'MuseoModerno', sans-serif",
              textTransform: 'lowercase',
              whiteSpace: 'nowrap',
            }}
          >
            {t('login.tagline')}
          </p>
        </div>

        <style>{`
          .takeoff-sky {
            background: linear-gradient(to top, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #0a0a23 100%);
            animation: skyShift 2.6s ease-in-out forwards;
          }
          @keyframes skyShift {
            0%   { background: linear-gradient(to top, #0a0a23 0%, #0f172a 40%, #111827 100%); }
            100% { background: linear-gradient(to top, #000011 0%, #000016 50%, #000011 100%); }
          }

          .takeoff-star {
            opacity: 0;
            animation: starAppear 0.5s ease-out forwards, starTwinkle 2s ease-in-out infinite alternate;
          }
          @keyframes starAppear {
            0%   { opacity: 0; transform: scale(0); }
            100% { opacity: 0.7; transform: scale(1); }
          }
          @keyframes starTwinkle {
            0%   { opacity: 0.3; }
            100% { opacity: 0.9; }
          }

          .takeoff-cloud {
            animation: cloudRush 0.6s ease-in forwards;
          }
          @keyframes cloudRush {
            0%   { right: -200px; opacity: 0; }
            20%  { opacity: 0.4; }
            100% { right: 120%; opacity: 0; }
          }

          .takeoff-speedline {
            animation: speedRush 0.4s ease-in forwards;
          }
          @keyframes speedRush {
            0%   { right: -200px; opacity: 0; }
            30%  { opacity: 0.6; }
            100% { right: 120%; opacity: 0; }
          }

          .takeoff-plane {
            animation: planeUp 1s ease-in forwards;
          }
          @keyframes planeUp {
            0%   { transform: translate(-50%, 0) rotate(0deg) scale(1); bottom: 8%; left: 50%; opacity: 1; }
            100% { transform: translate(-50%, 0) rotate(-22deg) scale(0.15); bottom: 120%; left: 58%; opacity: 0; }
          }

          .takeoff-trail {
            animation: trailGrow 0.9s ease-out 0.15s forwards;
          }
          @keyframes trailGrow {
            0%   { height: 0; opacity: 0; transform: translateX(-50%) rotate(-5deg); }
            30%  { height: 150px; opacity: 0.6; }
            60%  { height: 350px; opacity: 0.4; }
            100% { height: 600px; opacity: 0; transform: translateX(-50%) rotate(-8deg); }
          }

          .takeoff-logo {
            opacity: 0;
            animation: logoReveal 0.5s ease-out 0.9s forwards;
          }
          @keyframes logoReveal {
            0%   { opacity: 0; transform: translate(-50%, -40%) scale(0.9); }
            100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      className="login-page-shell"
      style={{
        minHeight: '100vh',
        height: '100dvh',
        display: 'flex',
        fontFamily: 'var(--font-system)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Back to landing page */}
      <div className="login-home-button-wrap" style={{ position: 'absolute', top: 16, left: 16, zIndex: 10 }}>
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Back to home"
          title="Back to home"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            padding: 0,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.06)',
            border: 'none',
            color: '#374151',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) =>
            (e.currentTarget.style.background = 'rgba(0,0,0,0.1)')
          }
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) =>
            (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')
          }
        >
          <Home size={18} strokeWidth={2.2} />
        </button>
      </div>

      {/* Language dropdown */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setLangDropdownOpen((o) => !o);
          }}
          aria-haspopup="listbox"
          aria-expanded={langDropdownOpen}
          aria-label="Change language"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 99,
            background: 'rgba(0,0,0,0.06)',
            border: 'none',
            fontSize: 13,
            fontWeight: 500,
            color: '#374151',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) =>
            (e.currentTarget.style.background = 'rgba(0,0,0,0.1)')
          }
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) =>
            (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')
          }
        >
          <Globe size={14} />
          {SUPPORTED_LANGUAGES.find((l) => l.value === language)?.label ?? language.toUpperCase()}
          <ChevronDown
            size={12}
            style={{ transition: 'transform 0.15s', transform: langDropdownOpen ? 'rotate(180deg)' : 'none' }}
          />
        </button>

        {langDropdownOpen && (
          <div
            role="listbox"
            aria-label="Select language"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: 'white',
              borderRadius: 12,
              boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
              border: '1px solid rgba(0,0,0,0.08)',
              minWidth: 190,
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            {SUPPORTED_LANGUAGES.map(({ value, label }) => (
              <button
                key={value}
                role="option"
                aria-selected={value === language}
                onClick={() => {
                  setLanguageLocal(value);
                  setLangDropdownOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 16px',
                  border: 'none',
                  background: value === language ? 'rgba(99,102,241,0.08)' : 'transparent',
                  color: value === language ? '#4f46e5' : '#374151',
                  fontWeight: value === language ? 600 : 400,
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                  if (value !== language) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                  if (value !== language) e.currentTarget.style.background = 'transparent';
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Left — storybook branding */}
      <div
        style={{
          display: 'none',
          width: '55%',
          background: '#ebe4d8',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '52px 46px',
          position: 'relative',
          overflow: 'hidden',
          borderRight: '1px solid rgba(111,75,44,0.12)',
        }}
        className="lg-panel"
      >
        <style>{`@media(min-width:1024px){.lg-panel{display:flex!important}}`}</style>

        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle at 20% 18%, rgba(255,250,238,0.72) 0 1px, transparent 2px), radial-gradient(circle at 64% 28%, rgba(173,151,110,0.28) 0 1px, transparent 2px), radial-gradient(circle at 82% 68%, rgba(255,250,238,0.72) 0 1px, transparent 2px)',
            backgroundSize: '68px 68px, 92px 92px, 120px 120px',
          }}
        />
        <div aria-hidden="true" className="storybook-star storybook-star--one" />
        <div aria-hidden="true" className="storybook-star storybook-star--two" />
        <div aria-hidden="true" className="storybook-star storybook-star--three" />
        <img
          aria-hidden="true"
          className="storybook-float storybook-float--balloon"
          src="/brand/storybook/balloon.png"
          alt=""
        />
        <img aria-hidden="true" className="storybook-float storybook-float--wand" src="/brand/storybook/wand.png" alt="" />
        <img
          aria-hidden="true"
          className="storybook-float storybook-float--passport"
          src="/brand/storybook/passport.png"
          alt=""
        />

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            width: 'min(560px, 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 34,
              color: '#6f4b2c',
            }}
          >
            <img
              src="/brand/trippi-wordmark.png"
              alt="trippi.ai"
              className="brand-wordmark"
              style={{ height: 42, filter: 'sepia(0.25) saturate(0.85)' }}
            />
          </div>

          <div
            style={{
              position: 'relative',
              width: 'min(440px, 72vh)',
              aspectRatio: '1',
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 50% 45%, rgba(255,250,238,0.96), rgba(246,234,214,0.9) 62%, rgba(231,218,196,0.78) 100%)',
              border: '2px solid rgba(111,75,44,0.34)',
              boxShadow: '0 22px 70px rgba(111,75,44,0.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 34,
            }}
          >
            <img
              src="/brand/storybook/suitcase.png"
              alt=""
              aria-hidden="true"
              className="storybook-hero-sticker"
              style={{
                width: '78%',
                maxWidth: 390,
                transform: 'rotate(-2deg)',
                filter: 'drop-shadow(0 16px 20px rgba(111,75,44,0.18))',
              }}
            />
            <img
              src="/brand/storybook/train.png"
              alt=""
              aria-hidden="true"
              className="storybook-train-sticker"
              style={{
                position: 'absolute',
                width: '34%',
                right: '-5%',
                bottom: '7%',
                transform: 'rotate(5deg)',
                filter: 'drop-shadow(0 12px 16px rgba(111,75,44,0.18))',
              }}
            />
            <img
              src="/brand/storybook/map.png"
              alt=""
              aria-hidden="true"
              className="storybook-map-sticker"
              style={{
                position: 'absolute',
                width: '29%',
                left: '-2%',
                bottom: '17%',
                transform: 'rotate(-9deg)',
                filter: 'drop-shadow(0 10px 14px rgba(111,75,44,0.16))',
              }}
            />
          </div>

          <h2
            style={{
              margin: '0 0 12px',
              fontSize: 'clamp(34px, 4.7vw, 58px)',
              fontWeight: 800,
              color: '#4e3321',
              lineHeight: 1,
              fontFamily: "'MuseoModerno', var(--font-system)",
              textTransform: 'lowercase',
              textWrap: 'balance',
            }}
          >
            {t('login.tagline')}
          </h2>
          <p style={{ margin: '0 0 22px', maxWidth: 420, fontSize: 16, color: '#7b6853', lineHeight: 1.7 }}>
            {t('login.description')}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 10,
              width: '100%',
              maxWidth: 500,
            }}
          >
            {[
              { label: 'Plan smarter', value: 'first draft' },
              { label: 'Less confusion', value: 'shared vibe' },
              { label: 'More fun', value: 'one tiny Troppa' },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  border: '1px solid rgba(111,75,44,0.18)',
                  borderRadius: 18,
                  padding: '14px 12px',
                  background: 'rgba(255,250,238,0.72)',
                  boxShadow: '0 8px 28px rgba(111,75,44,0.07)',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: '#4e3321', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 11.5, color: '#8a7560', lineHeight: 1.35 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — form */}
      <div
        className="login-form-panel"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 24px',
          background: '#f9fafb',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div
          className="login-form-shell"
          style={{
            width: '100%',
            maxWidth: 400,
            maxHeight: '100%',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            scrollbarGutter: 'stable',
            boxSizing: 'border-box',
            padding: '4px 0',
          }}
        >
          {/* Mobile logo */}
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 36 }}
            className="mobile-logo"
          >
            <style>{`@media(min-width:1024px){.mobile-logo{display:none!important}}`}</style>
            <img src="/brand/trippi-wordmark.png" alt="trippi.ai" className="brand-wordmark" style={{ height: 48 }} />
            <p
              style={{
                margin: 0,
                fontSize: 16,
                color: '#9ca3af',
                fontFamily: "'MuseoModerno', sans-serif",
                textTransform: 'lowercase',
                whiteSpace: 'nowrap',
              }}
            >
              {t('login.tagline')}
            </p>
          </div>

          <div
            className="login-card"
            style={{
              background: 'white',
              borderRadius: 20,
              border: '1px solid #e5e7eb',
              padding: '36px 32px',
              boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
            }}
          >
            {oidcOnly ? (
              <>
                <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: '#111827' }}>
                  {t('login.title')}
                </h2>
                <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#9ca3af' }}>
                  {noRedirect ? t('login.oidcLoggedOut') : t('login.oidcOnly')}
                </p>
	                  {error && (
	                    <div
                    style={{
                      padding: '10px 14px',
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: 10,
                      fontSize: 13,
                      color: '#dc2626',
                      marginBottom: 16,
                    }}
                  >
                    {error}
	                    </div>
	                  )}
                <a
                  href={`/api/auth/oidc/login${oidcSignupQuery}`}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: '#111827',
                    color: 'white',
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    textDecoration: 'none',
                    transition: 'background 180ms cubic-bezier(0.23,1,0.32,1)',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.background = '#1f2937';
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.background = '#111827';
                  }}
                >
                  <Shield size={16} />
                  {t('login.oidcSignIn', { name: appConfig?.oidc_display_name || 'SSO' })}
                </a>
              </>
            ) : (
              <>
                <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: '#111827' }}>
                  {passwordChangeStep
                    ? t('login.setNewPassword')
                    : mode === 'login' && mfaStep
                      ? t('login.mfaTitle')
                      : mode === 'register'
                        ? !appConfig?.has_users
                          ? t('login.createAdmin')
                          : t('login.createAccount')
                        : t('login.title')}
                </h2>
                <p style={{ margin: '0 0 28px', fontSize: 13.5, color: '#9ca3af' }}>
                  {passwordChangeStep
                    ? t('login.setNewPasswordHint')
                    : mode === 'login' && mfaStep
                      ? t('login.mfaSubtitle')
                      : mode === 'register'
                        ? !appConfig?.has_users
                          ? t('login.createAdminHint')
                          : t('login.createAccountHint')
                        : t('login.subtitle')}
                </p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
	                  {error && (
	                    <div
                      style={{
                        padding: '10px 14px',
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: 10,
                        fontSize: 13,
                        color: '#dc2626',
                      }}
                    >
                      {error}
	                    </div>
	                  )}

                  {mode === 'register' && referralInfo && !error && (
                    <div
                      style={{
                        padding: '10px 14px',
                        background: '#ecfdf5',
                        border: '1px solid #bbf7d0',
                        borderRadius: 10,
                        fontSize: 13,
                        color: '#047857',
                        lineHeight: 1.45,
                      }}
                    >
                      {t('login.referralAccepted', {
                        name: referralInfo.referrer_username || t('login.referralAFriend'),
                        days: referralInfo.reward_days,
                      })}
                    </div>
                  )}

	                  {passwordChangeStep && (
                    <>
                      <div
                        style={{
                          padding: '10px 14px',
                          background: '#fefce8',
                          border: '1px solid #fde68a',
                          borderRadius: 10,
                          fontSize: 13,
                          color: '#92400e',
                        }}
                      >
                        {t('settings.mustChangePassword')}
                      </div>
                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: '#374151',
                            marginBottom: 6,
                          }}
                        >
                          {t('settings.newPassword')}
                        </label>
                        <div style={{ position: 'relative' }}>
                          <Lock
                            size={15}
                            className="text-[#9ca3af]"
                            style={{
                              position: 'absolute',
                              left: 13,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              pointerEvents: 'none',
                            }}
                          />
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
                            required
                            placeholder={t('settings.newPassword')}
                            style={inputBase}
                            onFocus={(e: React.FocusEvent<HTMLInputElement>) =>
                              (e.target.style.borderColor = '#111827')
                            }
                            onBlur={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#e5e7eb')}
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: '#374151',
                            marginBottom: 6,
                          }}
                        >
                          {t('settings.confirmPassword')}
                        </label>
                        <div style={{ position: 'relative' }}>
                          <Lock
                            size={15}
                            className="text-[#9ca3af]"
                            style={{
                              position: 'absolute',
                              left: 13,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              pointerEvents: 'none',
                            }}
                          />
                          <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                            required
                            placeholder={t('settings.confirmPassword')}
                            style={inputBase}
                            onFocus={(e: React.FocusEvent<HTMLInputElement>) =>
                              (e.target.style.borderColor = '#111827')
                            }
                            onBlur={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#e5e7eb')}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {mode === 'login' && mfaStep && !passwordChangeStep && (
                    <div>
                      <label
                        style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}
                      >
                        {t('login.mfaCodeLabel')}
                      </label>
                      <div style={{ position: 'relative' }}>
                        <KeyRound
                          size={15}
                          className="text-[#9ca3af]"
                          style={{
                            position: 'absolute',
                            left: 13,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            pointerEvents: 'none',
                          }}
                        />
                        <input
                          type="text"
                          inputMode="text"
                          autoComplete="one-time-code"
                          value={mfaCode}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setMfaCode(e.target.value.toUpperCase().slice(0, 24))
                          }
                          placeholder="000000 or XXXX-XXXX"
                          required
                          autoFocus
                          style={inputBase}
                          onFocus={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#111827')}
                          onBlur={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#e5e7eb')}
                        />
                      </div>
                      <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>{t('login.mfaHint')}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setMfaStep(false);
                          setMfaToken('');
                          setMfaCode('');
                          setError('');
                        }}
                        style={{
                          marginTop: 8,
                          background: 'none',
                          border: 'none',
                          color: '#6b7280',
                          fontSize: 13,
                          cursor: 'pointer',
                          padding: 0,
                          fontFamily: 'inherit',
                        }}
                      >
                        {t('login.mfaBack')}
                      </button>
                    </div>
                  )}

                  {/* Username (register only) */}
                  {mode === 'register' && !passwordChangeStep && (
                    <div>
                      <label
                        style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}
                      >
                        {t('login.username')}
                      </label>
                      <div style={{ position: 'relative' }}>
                        <User
                          size={15}
                          className="text-[#9ca3af]"
                          style={{
                            position: 'absolute',
                            left: 13,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            pointerEvents: 'none',
                          }}
                        />
                        <input
                          type="text"
                          value={username}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                          required
                          placeholder="admin"
                          style={inputBase}
                          onFocus={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#111827')}
                          onBlur={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#e5e7eb')}
                        />
                      </div>
                    </div>
                  )}

                  {/* Email */}
                  {!(mode === 'login' && mfaStep) && !passwordChangeStep && (
                    <div>
                      <label
                        style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}
                      >
                        {t('common.email')}
                      </label>
                      <div style={{ position: 'relative' }}>
                        <Mail
                          size={15}
                          className="text-[#9ca3af]"
                          style={{
                            position: 'absolute',
                            left: 13,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            pointerEvents: 'none',
                          }}
                        />
                        <input
                          type="email"
                          value={email}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                          required
                          placeholder={t('login.emailPlaceholder')}
                          style={inputBase}
                          onFocus={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#111827')}
                          onBlur={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#e5e7eb')}
                        />
                      </div>
                    </div>
                  )}

                  {/* Password */}
                  {!(mode === 'login' && mfaStep) && !passwordChangeStep && (
                    <div>
                      <label
                        style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}
                      >
                        {t('common.password')}
                      </label>
                      <div style={{ position: 'relative' }}>
                        <Lock
                          size={15}
                          className="text-[#9ca3af]"
                          style={{
                            position: 'absolute',
                            left: 13,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            pointerEvents: 'none',
                          }}
                        />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                          required
                          placeholder="••••••••"
                          style={{ ...inputBase, paddingRight: 44 }}
                          onFocus={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#111827')}
                          onBlur={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.borderColor = '#e5e7eb')}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          style={{
                            position: 'absolute',
                            right: 12,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 2,
                            color: '#9ca3af',
                            width: 22,
                            height: 22,
                          }}
                        >
                          <Eye
                            size={16}
                            style={{
                              position: 'absolute',
                              inset: 3,
                              opacity: showPassword ? 0 : 1,
                              transform: showPassword ? 'scale(0.7) rotate(-20deg)' : 'scale(1) rotate(0)',
                              transition:
                                'opacity 180ms cubic-bezier(0.23,1,0.32,1), transform 180ms cubic-bezier(0.23,1,0.32,1)',
                            }}
                          />
                          <EyeOff
                            size={16}
                            style={{
                              position: 'absolute',
                              inset: 3,
                              opacity: showPassword ? 1 : 0,
                              transform: showPassword ? 'scale(1) rotate(0)' : 'scale(0.7) rotate(20deg)',
                              transition:
                                'opacity 180ms cubic-bezier(0.23,1,0.32,1), transform 180ms cubic-bezier(0.23,1,0.32,1)',
                            }}
                          />
                        </button>
                      </div>
                      {mode === 'login' && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            marginTop: 8,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ToggleSwitch
                              on={rememberMe}
                              onToggle={() => setRememberMe(!rememberMe)}
                              label={t('login.rememberMe')}
                            />
                            <span
                              onClick={() => setRememberMe(!rememberMe)}
                              style={{
                                cursor: 'pointer',
                                color: '#374151',
                                fontSize: 12.5,
                                fontWeight: 500,
                                userSelect: 'none',
                              }}
                            >
                              {t('login.rememberMe')}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => navigate('/forgot-password')}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              color: '#6b7280',
                              fontSize: 12.5,
                              fontWeight: 500,
                              fontFamily: 'inherit',
                            }}
                            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                              e.currentTarget.style.color = '#111827';
                            }}
                            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                              e.currentTarget.style.color = '#6b7280';
                            }}
                          >
                            {t('login.forgotPassword')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    style={{
                      marginTop: 4,
                      width: '100%',
                      padding: '12px',
                      background: '#111827',
                      color: 'white',
                      border: 'none',
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: isLoading ? 'default' : 'pointer',
                      fontFamily: 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      opacity: isLoading ? 0.7 : 1,
                      transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                      if (!isLoading) e.currentTarget.style.background = '#1f2937';
                    }}
                    onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) =>
                      (e.currentTarget.style.background = '#111827')
                    }
                  >
                    {isLoading ? (
                      <>
                        <div
                          style={{
                            width: 15,
                            height: 15,
                            border: '2px solid rgba(255,255,255,0.3)',
                            borderTopColor: 'white',
                            borderRadius: '50%',
                            animation: 'spin 0.7s linear infinite',
                          }}
                        />
                        {passwordChangeStep
                          ? t('settings.updatePassword')
                          : mode === 'register'
                            ? t('login.creating')
                            : mode === 'login' && mfaStep
                              ? t('login.mfaVerify')
                              : t('login.signingIn')}
                      </>
                    ) : (
                      <>
                        <Plane size={16} />
                        {passwordChangeStep
                          ? t('settings.updatePassword')
                          : mode === 'register'
                            ? t('login.createAccount')
                            : mode === 'login' && mfaStep
                              ? t('login.mfaVerify')
                              : t('login.signIn')}
                      </>
                    )}
                  </button>
                </form>

                {/* Toggle login/register */}
                {reserveRegisterToggle && (
                  <p
                    aria-hidden={!showRegisterToggle}
                    style={{
                      textAlign: 'center',
                      marginTop: 16,
                      marginBottom: 0,
                      minHeight: 18,
                      fontSize: 13,
                      color: '#9ca3af',
                      visibility: showRegisterToggle ? 'visible' : 'hidden',
                      pointerEvents: showRegisterToggle ? 'auto' : 'none',
                    }}
                  >
                    {showRegisterToggle && (
                      <>
                        {mode === 'login' ? t('login.noAccount') + ' ' : t('login.hasAccount') + ' '}
                        <button
                          onClick={() => {
                            setMode((m) => (m === 'login' ? 'register' : 'login'));
                            setError('');
                            setMfaStep(false);
                            setMfaToken('');
                            setMfaCode('');
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#111827',
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            fontSize: 13,
                          }}
                        >
                          {mode === 'login' ? t('login.register') : t('login.signIn')}
                        </button>
                      </>
                    )}
                  </p>
                )}
              </>
            )}
          </div>

          {/* OIDC / SSO login button (only when OIDC is configured, oidc_login enabled, not in oidc-only mode) */}
          {appConfig?.oidc_configured && appConfig?.oidc_login && !oidcOnly && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                <span style={{ fontSize: 12, color: '#9ca3af' }}>{t('common.or')}</span>
                <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              </div>
              <a
                href={`/api/auth/oidc/login${oidcSignupQuery}`}
                style={{
                  marginTop: 12,
                  width: '100%',
                  padding: '12px',
                  background: 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  textDecoration: 'none',
                  transition:
                    'background 180ms cubic-bezier(0.23,1,0.32,1), border-color 180ms cubic-bezier(0.23,1,0.32,1)',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.style.background = '#f9fafb';
                  e.currentTarget.style.borderColor = '#9ca3af';
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.style.background = 'white';
                  e.currentTarget.style.borderColor = '#d1d5db';
                }}
              >
                <Shield size={16} />
                {t('login.oidcSignIn', { name: appConfig.oidc_display_name })}
              </a>
            </>
          )}

          {/* Passkey login button (instance toggle on + a usable RP ID resolves) */}
          {passkeyAvailable && (
            <>
              {!oidcButtonShown && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{t('common.or')}</span>
                  <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                </div>
              )}
              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={isLoading}
                style={{
                  marginTop: 12,
                  width: '100%',
                  padding: '12px',
                  background: 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: isLoading ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  opacity: isLoading ? 0.7 : 1,
                  transition:
                    'background 180ms cubic-bezier(0.23,1,0.32,1), border-color 180ms cubic-bezier(0.23,1,0.32,1)',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                  if (!isLoading) {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#9ca3af';
                  }
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.background = 'white';
                  e.currentTarget.style.borderColor = '#d1d5db';
                }}
              >
                <Fingerprint size={16} />
                {t('login.passkey.signIn')}
              </button>
            </>
          )}

          {/* Demo login button */}
          {appConfig?.demo_mode && (
            <button
              onClick={handleDemoLogin}
              disabled={isLoading}
              style={{
                marginTop: 16,
                width: '100%',
                padding: '14px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#451a03',
                border: 'none',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 700,
                cursor: isLoading ? 'default' : 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                opacity: isLoading ? 0.7 : 1,
                transition:
                  'transform 200ms cubic-bezier(0.23,1,0.32,1), box-shadow 200ms cubic-bezier(0.23,1,0.32,1), opacity 200ms cubic-bezier(0.23,1,0.32,1)',
                boxShadow: '0 2px 12px rgba(245, 158, 11, 0.3)',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (!isLoading) e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(245, 158, 11, 0.4)';
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 12px rgba(245, 158, 11, 0.3)';
              }}
            >
              <Plane size={18} />
              {t('login.demoHint')}
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        .storybook-star {
          position: absolute;
          width: 18px;
          height: 18px;
          background: #f3c45c;
          clip-path: polygon(50% 0%, 61% 34%, 98% 35%, 68% 56%, 79% 91%, 50% 70%, 21% 91%, 32% 56%, 2% 35%, 39% 34%);
          opacity: 0.72;
          filter: drop-shadow(0 2px 2px rgba(111,75,44,0.12));
          animation: storybookTwinkle 4.8s ease-in-out infinite;
        }
        .storybook-star--one { left: 11%; top: 18%; transform: rotate(-8deg); }
        .storybook-star--two { right: 17%; top: 24%; width: 14px; height: 14px; animation-delay: 1.1s; }
        .storybook-star--three { left: 18%; bottom: 19%; width: 22px; height: 22px; animation-delay: 2.2s; }
        .storybook-float {
          position: absolute;
          z-index: 0;
          pointer-events: none;
          filter: drop-shadow(0 12px 18px rgba(111,75,44,0.13));
          animation: storybookFloat 8s ease-in-out infinite;
        }
        .storybook-float--balloon {
          width: min(17vw, 150px);
          top: 9%;
          right: 9%;
          transform: rotate(9deg);
        }
        .storybook-float--wand {
          width: min(13vw, 112px);
          left: 7%;
          bottom: 11%;
          transform: rotate(-10deg);
          animation-delay: 1.6s;
        }
        .storybook-float--passport {
          width: min(12vw, 104px);
          right: 13%;
          bottom: 17%;
          transform: rotate(8deg);
          opacity: 0.84;
          animation-delay: 2.7s;
        }
        .storybook-hero-sticker { animation: storybookHeroBob 6.5s ease-in-out infinite; }
        .storybook-train-sticker { animation: storybookHeroBob 7.4s ease-in-out infinite 0.9s; }
        .storybook-map-sticker { animation: storybookHeroBob 8.2s ease-in-out infinite 1.4s; }
        @keyframes storybookTwinkle {
          0%, 100% { opacity: 0.42; transform: translateY(0) rotate(-8deg) scale(0.94); }
          50% { opacity: 0.9; transform: translateY(-5px) rotate(4deg) scale(1.06); }
        }
        @keyframes storybookFloat {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 -12px; }
        }
        @keyframes storybookHeroBob {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 -7px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .storybook-star,
          .storybook-float,
          .storybook-hero-sticker,
          .storybook-train-sticker,
          .storybook-map-sticker {
            animation: none !important;
          }
        }
        @keyframes orbFloat1 {
          0%, 100% { top: 15%; left: 30%; }
          25% { top: 25%; left: 55%; }
          50% { top: 45%; left: 40%; }
          75% { top: 20%; left: 20%; }
        }
        @keyframes orbFloat2 {
          0%, 100% { bottom: 20%; right: 15%; }
          25% { bottom: 35%; right: 35%; }
          50% { bottom: 15%; right: 45%; }
          75% { bottom: 40%; right: 20%; }
        }
        .login-orb1 { animation: orbFloat1 20s ease-in-out infinite; }
        .login-orb2 { animation: orbFloat2 25s ease-in-out infinite; }

        @keyframes twinkle {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.5; }
        }
        .login-star { animation: twinkle 3s ease-in-out infinite; }

        @keyframes plane1Move {
          0%   { left: -8%; top: 30%; transform: rotate(-8deg); }
          100% { left: 108%; top: 10%; transform: rotate(-12deg); }
        }
        @keyframes plane2Move {
          0%   { right: -5%; top: 18%; transform: rotate(5deg); }
          100% { right: 110%; top: 8%; transform: rotate(3deg); }
        }
        @keyframes plane3Move {
          0%   { left: -6%; top: 55%; transform: rotate(-10deg); }
          100% { left: 110%; top: 35%; transform: rotate(-6deg); }
        }
        @keyframes plane4Move {
          0%   { left: -4%; top: 8%; transform: rotate(-3deg); }
          100% { left: 110%; top: 5%; transform: rotate(-5deg); }
        }
        @keyframes plane5Move {
          0%   { right: -6%; top: 65%; transform: rotate(3deg); }
          100% { right: 110%; top: 50%; transform: rotate(-2deg); }
        }
        @keyframes plane6Move {
          0%   { left: -3%; top: 75%; transform: rotate(-7deg); }
          100% { left: 110%; top: 58%; transform: rotate(-5deg); }
        }
        .login-plane1 { animation: plane1Move 24s ease-in-out infinite; }
        .login-plane2 { animation: plane2Move 18s ease-in-out infinite; animation-delay: 6s; }
        .login-plane3 { animation: plane3Move 30s ease-in-out infinite; animation-delay: 12s; }
        .login-plane4 { animation: plane4Move 14s ease-in-out infinite; animation-delay: 3s; }
        .login-plane5 { animation: plane5Move 22s ease-in-out infinite; animation-delay: 9s; }
        .login-plane6 { animation: plane6Move 32s ease-in-out infinite; animation-delay: 16s; }

        @media (min-width: 1024px) {
          .login-home-button-wrap {
            left: calc(55% + 16px) !important;
          }
        }

        @media (max-width: 1023px) {
          .login-form-panel {
            padding: 20px 18px !important;
          }
          .login-form-shell {
            max-height: 100%;
          }
          .mobile-logo {
            margin-bottom: 22px !important;
          }
          .login-card {
            padding: 28px 24px !important;
            border-radius: 18px !important;
          }
        }

        @media (max-width: 380px), (max-height: 720px) {
          .login-form-panel {
            padding: 16px !important;
          }
          .mobile-logo {
            margin-bottom: 18px !important;
          }
          .mobile-logo .brand-wordmark {
            height: 40px !important;
          }
          .mobile-logo p {
            font-size: 14px !important;
          }
          .login-card {
            padding: 24px 20px !important;
          }
        }
      `}</style>
    </div>
  );
}
