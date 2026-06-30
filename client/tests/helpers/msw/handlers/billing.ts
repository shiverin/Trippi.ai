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
          mcpAutomation: { maxTokens: 10, maxConcurrentSessions: 200, requestsPerMinute: 300 },
          activeTrips: 3,
          groupSize: 3,
        },
      },
      billing: { checkoutAvailable: false, defaultPlanId: null, portalAvailable: false },
    })
  ),

  http.post('/api/billing/checkout-session', () => HttpResponse.json({ url: 'https://checkout.example.test/session' })),
  http.post('/api/billing/portal-session', () => HttpResponse.json({ url: 'https://billing.example.test/session' })),
];
