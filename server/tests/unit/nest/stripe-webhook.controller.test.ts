import { StripeWebhookController } from '../../../src/nest/billing/stripe-webhook.controller';
import { StripeWebhookService } from '../../../src/nest/billing/stripe-webhook.service';
import { HttpException } from '@nestjs/common';

import Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'whsec_test_secret';

function signedPayload(payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
}

describe('StripeWebhookController', () => {
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it('verifies the Stripe signature before handling the event', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const service = new StripeWebhookService();
    const handleEvent = vi.spyOn(service, 'handleEvent').mockResolvedValue({ duplicate: false, handled: true });
    const controller = new StripeWebhookController(service);
    const payload = JSON.stringify({
      id: 'evt_signed',
      object: 'event',
      type: 'customer.subscription.created',
      created: 1782864000,
      data: { object: { id: 'sub_signed', object: 'subscription' } },
    });

    await expect(controller.receive({ body: Buffer.from(payload) } as any, signedPayload(payload))).resolves.toEqual({
      received: true,
      duplicate: false,
      handled: true,
    });

    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt_signed' }));
  });

  it('rejects invalid signatures', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const service = new StripeWebhookService();
    vi.spyOn(service, 'handleEvent').mockResolvedValue({ duplicate: false, handled: true });
    const controller = new StripeWebhookController(service);
    const payload = JSON.stringify({ id: 'evt_bad', object: 'event', type: 'customer.created', data: { object: {} } });

    const error = await controller.receive({ body: Buffer.from(payload) } as any, 't=1,v1=bad').catch((err) => err);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({ error: 'Invalid Stripe signature' });
  });

  it('requires the raw request body', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const controller = new StripeWebhookController(new StripeWebhookService());

    await controller.receive({ body: { parsed: true } } as any, 'sig').catch((err: HttpException) => {
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toEqual({ error: 'Missing raw Stripe webhook body' });
    });
  });
});
