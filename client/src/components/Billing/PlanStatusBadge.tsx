import { Clock3, Crown } from 'lucide-react';
import React from 'react';
import { useTranslation } from '../../i18n';
import type { BillingAccessSummary } from '../../types';
import { formatAccessDetail, formatPlanName } from './accessCopy';

interface PlanStatusBadgeProps {
  access: BillingAccessSummary | null | undefined;
  onClick?: () => void;
  className?: string;
}

export default function PlanStatusBadge({ access, onClick, className = '' }: PlanStatusBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const content = (
    <>
      <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
        {access?.source === 'free' ? <Clock3 className="h-4 w-4" /> : <Crown className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-content">{formatPlanName(access, t)}</span>
        <span className="block truncate text-xs text-content-muted">{formatAccessDetail(access, t)}</span>
      </span>
    </>
  );

  const classes = `flex w-full items-center gap-3 rounded-xl border border-edge bg-surface-secondary px-3 py-2 text-left ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${classes} transition-colors hover:bg-surface-tertiary`}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}
