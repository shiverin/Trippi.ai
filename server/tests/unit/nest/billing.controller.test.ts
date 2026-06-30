import { BillingController } from '../../../src/nest/billing/billing.controller';
import { BillingError, BillingService } from '../../../src/nest/billing/billing.service';
import type { User } from '../../../src/types';
import { HttpException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';

const user = { id: 7, email: 'organizer@example.test', role: 'user' } as User;

function controller(svc: Partial<BillingService>): BillingController {
  return new BillingController(svc as BillingService);
}

async function thrown(fn: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    return { status: exception.getStatus(), body: exception.getResponse() };
  }
  throw new Error('expected HttpException');
}

describe('BillingController', () => {
  it('creates checkout sessions for the current user', async () => {
    const createCheckoutSession = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/cs' });

    await expect(controller({ createCheckoutSession }).createCheckoutSession(user, { planId: 'pro' })).resolves.toEqual(
      {
        url: 'https://checkout.stripe.test/cs',
      },
    );
    expect(createCheckoutSession).toHaveBeenCalledWith(user, { planId: 'pro' });
  });

  it('creates portal sessions for the current user', async () => {
    const createPortalSession = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.test/session' });

    await expect(
      controller({ createPortalSession }).createPortalSession(user, { returnUrl: '/billing' }),
    ).resolves.toEqual({
      url: 'https://billing.stripe.test/session',
    });
    expect(createPortalSession).toHaveBeenCalledWith(user, { returnUrl: '/billing' });
  });

  it('maps billing errors to friendly error envelopes', async () => {
    const createCheckoutSession = vi.fn().mockRejectedValue(new BillingError(400, 'Choose a valid billing plan.'));

    await expect(
      thrown(() => controller({ createCheckoutSession }).createCheckoutSession(user, { planId: 'bad' })),
    ).resolves.toEqual({
      status: 400,
      body: { error: 'Choose a valid billing plan.' },
    });
  });
});
