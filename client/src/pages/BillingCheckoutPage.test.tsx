import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingPlanOptions } from '../../tests/helpers/msw/handlers/billing';
import { server } from '../../tests/helpers/msw/server';
import { render, screen, waitFor } from '../../tests/helpers/render';
import { resetAllStores } from '../../tests/helpers/store';
import BillingCheckoutPage from './BillingCheckoutPage';

const SUCCESS_URL = '/billing/success?session_id={CHECKOUT_SESSION_ID}';

let savedLocation: Location;
let assignMock: ReturnType<typeof vi.fn>;

function entitlementResponse() {
  return {
    entitlements: {
      userId: 1,
      planKey: 'free',
      billingPlanKey: 'free',
      billingStatus: 'free',
      subscribed: false,
      trialing: false,
      limits: {
        aiWorkers: 0,
        priceWatches: 0,
        mcpAutomation: { maxTokens: 0, maxConcurrentSessions: 0, requestsPerMinute: 0 },
        activeTrips: 5,
        groupSize: 1,
      },
      referralBonus: {
        active: false,
        activeUntil: null,
        pendingDays: 0,
        daysRemaining: 0,
        expiresSoon: false,
        maxDays: 90,
      },
    },
    access: {
      source: 'free',
      planKey: 'free',
      activeUntil: null,
      daysRemaining: null,
      renews: false,
      cancelAtPeriodEnd: false,
    },
    usage: {
      lifetimeTrips: { current: 0, limit: 5, locked: 0, editableFreeTrips: 5 },
      groupSize: { limit: 1 },
      referralBonus: { activeDays: 0, pendingDays: 0, maxDays: 90 },
    },
    billing: {
      checkoutAvailable: true,
      defaultPlanId: 'pro_monthly',
      portalAvailable: false,
      plans: billingPlanOptions,
    },
  };
}

beforeEach(() => {
  resetAllStores();
  savedLocation = window.location;
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, assign: assignMock },
  });
  server.use(http.get('/api/billing/entitlements', () => HttpResponse.json(entitlementResponse())));
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: savedLocation,
  });
});

describe('BillingCheckoutPage', () => {
  it('shows monthly and annual Pro choices for the Pro landing intent', async () => {
    render(<BillingCheckoutPage />, { initialEntries: ['/billing/checkout?plan=pro'] });

    expect(await screen.findByRole('heading', { name: /choose your pro term/i })).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Pro for 12 months')).toBeInTheDocument();
    expect(screen.queryByText('Agency')).toBeNull();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('starts checkout with selected annual Pro plan and funnel return URLs', async () => {
    const user = userEvent.setup();
    let checkoutBody: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/billing/checkout-session', async ({ request }) => {
        checkoutBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ url: 'https://checkout.example.test/pro-annual' });
      }),
    );

    render(<BillingCheckoutPage />, { initialEntries: ['/billing/checkout?plan=pro'] });

    const annualLabel = await screen.findByText('Pro for 12 months');
    await user.click(annualLabel.closest('button')!);

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://checkout.example.test/pro-annual'));
    expect(checkoutBody).toEqual({
      planId: 'pro_annual',
      successUrl: SUCCESS_URL,
      cancelUrl: '/billing/checkout?plan=pro&cancelled=1',
    });
  });

  it('auto-starts Agency checkout from the Agency landing intent', async () => {
    let checkoutBody: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/billing/checkout-session', async ({ request }) => {
        checkoutBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ url: 'https://checkout.example.test/agency' });
      }),
    );

    render(<BillingCheckoutPage />, { initialEntries: ['/billing/checkout?plan=agency'] });

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://checkout.example.test/agency'));
    expect(checkoutBody).toEqual({
      planId: 'agency_annual',
      successUrl: SUCCESS_URL,
      cancelUrl: '/billing/checkout?plan=agency&cancelled=1',
    });
  });

  it('does not auto-restart checkout after a canceled Agency session', async () => {
    render(<BillingCheckoutPage />, { initialEntries: ['/billing/checkout?plan=agency&cancelled=1'] });

    expect(await screen.findByText(/checkout was canceled/i)).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByText('Agency')).toBeInTheDocument();
  });
});
