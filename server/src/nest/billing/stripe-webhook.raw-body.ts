import express from 'express';

export function applyStripeWebhookRawBody(app: express.Application): void {
  app.use('/api/billing/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
}
