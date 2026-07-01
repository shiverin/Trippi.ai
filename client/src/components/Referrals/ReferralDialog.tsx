import { Check, Copy, Gift, Loader2, Share2, Sparkles, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { referralsApi } from '../../api/client';
import { useTranslation } from '../../i18n';
import type { ReferralSummary } from '../../types';
import { useToast } from '../shared/Toast';

interface ReferralDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function ReferralDialog({ open, onClose }: ReferralDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    referralsApi
      .me()
      .then(setSummary)
      .catch((err) => toast.error(err instanceof Error ? err.message : t('common.error')))
      .finally(() => setLoading(false));
  }, [open, t, toast]);

  if (!open) return null;

  const generate = async () => {
    setBusy(true);
    try {
      setSummary(await referralsApi.create());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const link = summary?.referral_url || '';
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success(t('referral.copied'));
    window.setTimeout(() => setCopied(false), 1600);
  };

  const share = async () => {
    if (!link) return copy();
    if (navigator.share) {
      await navigator.share({ title: t('referral.shareTitle'), text: t('referral.shareText'), url: link });
      return;
    }
    await copy();
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-edge bg-surface-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-text">
              <Gift className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-content">{t('referral.title')}</h2>
              <p className="text-xs text-content-muted">{t('referral.subtitle')}</p>
            </div>
          </div>
          <button className="rounded-lg p-2 text-content-muted hover:bg-surface-secondary" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-edge bg-surface-secondary p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" />
              <div>
                <p className="text-sm font-semibold text-content">{t('referral.valueTitle')}</p>
                <p className="mt-1 text-sm leading-6 text-content-muted">{t('referral.valueBody')}</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-content-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : link ? (
            <>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-content-muted">
                  {t('referral.yourLink')}
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={link}
                    className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-secondary px-3 py-2 text-sm text-content"
                  />
                  <button
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-text"
                    onClick={copy}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? t('common.copied') : t('common.copy')}
                  </button>
                  <button
                    className="grid h-10 w-10 place-items-center rounded-lg border border-edge text-content-secondary hover:bg-surface-secondary"
                    onClick={share}
                    title={t('common.share')}
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Stat label={t('referral.successful')} value={summary?.successful_referrals ?? 0} />
                <Stat label={t('referral.activeDays')} value={summary?.active_bonus_days_remaining ?? 0} />
                <Stat label={t('referral.pendingDays')} value={summary?.pending_bonus_days ?? 0} />
              </div>
            </>
          ) : (
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-text disabled:opacity-60"
              disabled={busy}
              onClick={generate}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
              {t('referral.generate')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value }: { label: string; value: number | string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-edge bg-surface-secondary p-3">
      <div className="text-lg font-semibold text-content">{value}</div>
      <div className="mt-1 text-xs text-content-muted">{label}</div>
    </div>
  );
}
