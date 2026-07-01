import { ArrowRight, CheckCircle2 } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

export default function BillingSuccessPage(): React.ReactElement {
  return (
    <main className="min-h-screen bg-surface-secondary px-4 py-10 text-content">
      <section className="mx-auto flex w-full max-w-2xl flex-col items-start gap-5 rounded-2xl border border-edge bg-surface-card p-6 shadow-sm">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-green-100 text-green-700">
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-content">Checkout complete</h1>
          <p className="mt-2 text-sm leading-6 text-content-muted">
            Stripe has received your subscription. Your Trippi access will update as soon as the billing webhook
            confirms the plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-text"
            to="/dashboard"
          >
            Go to dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            className="rounded-lg border border-edge bg-surface-secondary px-4 py-2 text-sm font-semibold text-content"
            to="/settings?tab=usage"
          >
            View billing
          </Link>
        </div>
      </section>
    </main>
  );
}
