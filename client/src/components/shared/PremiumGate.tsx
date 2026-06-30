import { ArrowUpRight, Loader2, Lock } from 'lucide-react';
import React from 'react';

interface LockedStateProps {
  title: string;
  description?: string;
  detail?: string;
  upgradeAvailable?: boolean;
  upgradePending?: boolean;
  actionLabel?: string;
  onUpgrade?: () => void;
  compact?: boolean;
  className?: string;
  testId?: string;
}

interface PremiumGateProps extends LockedStateProps {
  locked: boolean;
  children?: React.ReactNode;
}

export function LockedState({
  title,
  description,
  detail,
  upgradeAvailable = false,
  upgradePending = false,
  actionLabel = 'Upgrade',
  onUpgrade,
  compact = false,
  className = '',
  testId,
}: LockedStateProps): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className={`rounded-lg border border-edge bg-surface-secondary ${compact ? 'p-3' : 'p-4'} ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-edge bg-surface-card text-content-secondary">
          <Lock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-content">{title}</p>
            {detail && (
              <span className="rounded border border-edge bg-surface-card px-1.5 py-0.5 text-[11px] font-medium text-content-secondary">
                {detail}
              </span>
            )}
          </div>
          {description && <p className="mt-1 text-xs leading-5 text-content-muted">{description}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onUpgrade}
              disabled={!upgradeAvailable || upgradePending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-card px-2.5 py-1.5 text-xs font-semibold text-content-secondary transition-colors hover:bg-surface-tertiary disabled:cursor-default disabled:opacity-60"
            >
              {upgradePending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
              {upgradeAvailable ? actionLabel : 'Coming soon'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PremiumGate({ locked, children, ...lockedProps }: PremiumGateProps): React.ReactElement {
  if (!locked) return <>{children}</>;
  return <LockedState {...lockedProps} />;
}
