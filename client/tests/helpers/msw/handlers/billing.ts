import { http, HttpResponse } from 'msw';

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
          groupSize: null,
        },
      },
      billing: { checkoutAvailable: false, defaultPlanId: null, portalAvailable: false },
    })
  ),

  http.post('/api/billing/checkout-session', () => HttpResponse.json({ url: 'https://checkout.example.test/session' })),
  http.post('/api/billing/portal-session', () => HttpResponse.json({ url: 'https://billing.example.test/session' })),
];
