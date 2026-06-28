import { Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useRegister } from './register/useRegister';

export default function RegisterPage(): React.ReactElement {
  const { t } = useTranslation();
  // Page = wiring container: form state, validation + register flow live in the hook.
  const {
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    showPassword,
    setShowPassword,
    isLoading,
    error,
    handleSubmit,
  } = useRegister();

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden flex-col items-center justify-center bg-slate-900 p-12 text-white lg:flex lg:w-1/2">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10">
            <img src="/brand/trippi-icon-light.png" alt="trippi.ai" className="brand-icon h-12 w-12" />
          </div>
          <h1 className="mb-4 text-4xl font-bold">{t('register.getStarted')}</h1>
          <p className="text-lg leading-relaxed text-slate-300">{t('register.subtitle')}</p>

          <div className="mt-10 space-y-3 text-left">
            {[
              `✓ ${t('register.feature1')}`,
              `✓ ${t('register.feature2')}`,
              `✓ ${t('register.feature3')}`,
              `✓ ${t('register.feature4')}`,
              `✓ ${t('register.feature5')}`,
              `✓ ${t('register.feature6')}`,
            ].map((item) => (
              <p key={item} className="text-sm text-slate-200">
                {item}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center lg:hidden">
            <img src="/brand/trippi-icon.png" alt="trippi.ai" className="brand-icon h-10 w-10" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="mb-1 text-2xl font-bold text-slate-900">{t('register.createAccount')}</h2>
            <p className="mb-8 text-slate-500">{t('register.startPlanning')}</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('settings.username')}</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                    required
                    placeholder="johndoe"
                    minLength={3}
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-4 text-slate-900 placeholder-slate-400 transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus:border-transparent focus:ring-2 focus:ring-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('common.email')}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                    required
                    placeholder="your@email.com"
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-4 text-slate-900 placeholder-slate-400 transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus:border-transparent focus:ring-2 focus:ring-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">{t('common.password')}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                    required
                    placeholder={t('register.minChars')}
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-12 text-slate-900 placeholder-slate-400 transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus:border-transparent focus:ring-2 focus:ring-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  {t('register.confirmPassword')}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                    required
                    placeholder={t('register.repeatPassword')}
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-4 text-slate-900 placeholder-slate-400 transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus:border-transparent focus:ring-2 focus:ring-slate-400"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white transition-colors hover:bg-slate-700 disabled:bg-slate-400"
              >
                {isLoading ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                    {t('register.registering')}
                  </>
                ) : (
                  t('register.register')
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-slate-500">
                {t('register.hasAccount')}{' '}
                <Link to="/login" className="font-medium text-slate-900 hover:text-slate-700">
                  {t('register.signIn')}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
