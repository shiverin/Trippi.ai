import { requireStripeSecret, resolveBillingConfig } from './billing.config';
import { Injectable } from '@nestjs/common';

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

export interface StripeBillingPortalSession {
  id: string;
  url: string;
}

export class StripeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

@Injectable()
export class StripeClient {
  async createCheckoutSession(params: URLSearchParams): Promise<StripeCheckoutSession> {
    return this.postForm<StripeCheckoutSession>('/v1/checkout/sessions', params);
  }

  async createBillingPortalSession(params: URLSearchParams): Promise<StripeBillingPortalSession> {
    return this.postForm<StripeBillingPortalSession>('/v1/billing_portal/sessions', params);
  }

  private async postForm<T>(path: string, params: URLSearchParams): Promise<T> {
    const config = resolveBillingConfig();
    const secret = requireStripeSecret(config);

    const response = await fetch(`https://api.stripe.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': config.stripeApiVersion,
      },
      body: params.toString(),
    });

    const text = await response.text();
    const parsed = text ? safeJson(text) : null;

    if (!response.ok) {
      const stripeError =
        parsed && typeof parsed === 'object' ? (parsed as { error?: Record<string, unknown> }).error : null;
      console.warn('Stripe request failed', {
        status: response.status,
        code: typeof stripeError?.code === 'string' ? stripeError.code : undefined,
        type: typeof stripeError?.type === 'string' ? stripeError.type : undefined,
      });
      throw new StripeRequestError('Stripe request failed.', response.status);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new StripeRequestError('Stripe returned an invalid response.', 502);
    }

    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
