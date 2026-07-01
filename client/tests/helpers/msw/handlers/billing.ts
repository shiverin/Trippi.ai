import { http, HttpResponse } from 'msw';

export const billingPlanOptions = [
  {
    id: 'pro_monthly',
    planKey: 'pro',
    label: 'Pro',
    priceLabel: '$1.99',
    intervalLabel: 'per month',
    description: 'Full Pro planning for one month.',
  },
  {
    id: 'pro_annual',
    planKey: 'pro',
    label: 'Pro annual',
    priceLabel: '$10',
    intervalLabel: 'per 12 months',
    description: 'A year of Pro for frequent travelers.',
    badge: 'Best value',
    featured: true,
  },
  {
    id: 'agency_annual',
    planKey: 'agency',
    label: 'Agency',
    priceLabel: '$49',
    intervalLabel: 'per 12 months',
    description: 'Agency-scale limits for teams and trip operators.',
  },
];

export const billingHandlers = [
  http.get('/api/billing/entitlements', () =>
    HttpResponse.json({
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
      },
      billing: { checkoutAvailable: false, defaultPlanId: null, portalAvailable: false, plans: billingPlanOptions },
    })
  ),

  http.post('/api/billing/checkout-session', () => HttpResponse.json({ url: 'https://checkout.example.test/session' })),
  http.post('/api/billing/portal-session', () => HttpResponse.json({ url: 'https://billing.example.test/session' })),
];
