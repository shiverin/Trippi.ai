import { http, HttpResponse } from 'msw';
import { billingPlanOptions } from '../../../tests/helpers/msw/handlers/billing';
import { server } from '../../../tests/helpers/msw/server';
import { render, screen } from '../../../tests/helpers/render';
import UsageTab from './UsageTab';

describe('UsageTab', () => {
  it('shows the current plan, days remaining, friends referred, and billing actions', async () => {
    server.use(
      http.get('/api/referrals/me', () =>
        HttpResponse.json({
          code: 'FRIEND7',
          referral_url: 'http://localhost:3001/register?ref=FRIEND7',
          reward_days: 7,
          max_bonus_days: 90,
          successful_referrals: 3,
          pending_bonus_days: 7,
          active_bonus_until: '2999-01-01T00:00:00.000Z',
          active_bonus_days_remaining: 6,
          expires_soon: false,
        }),
      ),
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
    expect(screen.getByText('Days remaining')).toBeInTheDocument();
    expect(screen.getByText('6 days')).toBeInTheDocument();
    expect(screen.getByText('Friends referred')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('Lifetime trips')).not.toBeInTheDocument();
    expect(screen.queryByText('Read-only trips')).not.toBeInTheDocument();
    expect(screen.queryByText('Trip members')).not.toBeInTheDocument();
    expect(screen.queryByText('Referral days queued')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refer friends' })).toBeInTheDocument();
  });
});
