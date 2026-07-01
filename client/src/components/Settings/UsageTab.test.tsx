import { http, HttpResponse } from 'msw';
import { billingPlanOptions } from '../../../tests/helpers/msw/handlers/billing';
import { server } from '../../../tests/helpers/msw/server';
import { render, screen } from '../../../tests/helpers/render';
import UsageTab from './UsageTab';

describe('UsageTab', () => {
  it('shows plan access, referral days, usage limits, and billing actions', async () => {
    server.use(
      http.get('/api/billing/entitlements', () =>
        HttpResponse.json({
          entitlements: {
            userId: 1,
            planKey: 'pro',
            billingPlanKey: 'referral_bonus',
            billingStatus: 'referral_bonus',
            subscribed: false,
            trialing: false,
            limits: {
              aiWorkers: 0,
              priceWatches: 0,
              mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
              activeTrips: 100,
              groupSize: null,
            },
            referralBonus: {
              active: true,
              activeUntil: '2999-01-01T00:00:00.000Z',
              pendingDays: 7,
              daysRemaining: 6,
              expiresSoon: false,
              maxDays: 90,
            },
          },
          access: {
            source: 'referral_bonus',
            planKey: 'pro',
            activeUntil: '2999-01-01T00:00:00.000Z',
            daysRemaining: 6,
            renews: false,
            cancelAtPeriodEnd: false,
          },
          usage: {
            lifetimeTrips: { current: 8, limit: 100, locked: 2, editableFreeTrips: 5 },
            groupSize: { limit: null },
            referralBonus: { activeDays: 6, pendingDays: 7, maxDays: 90 },
          },
          billing: {
            checkoutAvailable: true,
            defaultPlanId: 'pro_monthly',
            portalAvailable: true,
            plans: billingPlanOptions,
          },
        }),
      ),
    );

    render(<UsageTab />);

    expect(await screen.findByText('Referral Pro')).toBeInTheDocument();
    expect(screen.getByText('6 days left')).toBeInTheDocument();
    expect(screen.getByText('8/100')).toBeInTheDocument();
    expect(screen.getByText('Read-only trips')).toBeInTheDocument();
    expect(screen.getByText('Referral days queued')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refer friends' })).toBeInTheDocument();
  });
});
