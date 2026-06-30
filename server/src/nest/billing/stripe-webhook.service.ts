import {
  getBillingUserIdByStripeCustomerId,
  getBillingUserIdByStripeSubscriptionId,
  getProcessedStripeWebhookEvent,
  markStripeCustomerSubscriptionsCanceled,
  markStripeSubscriptionPaymentFailed,
  recordProcessedStripeWebhookEvent,
  upsertBillingCustomer,
  upsertStripeSubscriptionState,
  userExists,
} from '../../services/subscriptionService';
import { HttpException, Injectable } from '@nestjs/common';

import Stripe from 'stripe';

type Metadata = Record<string, string | undefined> | null | undefined;

interface HandleResult {
  duplicate: boolean;
  handled: boolean;
}

interface StripeList<T> {
  data?: T[];
}

interface StripePriceLike {
  id?: string;
  lookup_key?: string | null;
  metadata?: Metadata;
  nickname?: string | null;
}

interface StripeSubscriptionItemLike {
  current_period_start?: number | null;
  current_period_end?: number | null;
  price?: StripePriceLike | string | null;
}

interface StripeSubscriptionLike {
  id: string;
  customer?: string | { id?: string; metadata?: Metadata } | null;
  status?: string;
  metadata?: Metadata;
  items?: StripeList<StripeSubscriptionItemLike>;
  current_period_start?: number | null;
  current_period_end?: number | null;
  trial_start?: number | null;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: number | null;
}

interface StripeInvoiceLike {
  customer?: string | { id?: string; metadata?: Metadata } | null;
  subscription?: string | StripeSubscriptionLike | null;
  parent?: {
    subscription_details?: {
      metadata?: Metadata;
      subscription?: string | StripeSubscriptionLike | null;
    } | null;
  } | null;
  lines?: StripeList<{
    parent?: {
      invoice_item_details?: { subscription?: string | StripeSubscriptionLike | null } | null;
      subscription_item_details?: { subscription?: string | StripeSubscriptionLike | null } | null;
    } | null;
  }>;
}

const STRIPE_WEBHOOK_SECRET_KEYS = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SIGNING_SECRET'];
const USER_ID_METADATA_KEYS = ['trippi_user_id', 'user_id', 'userId', 'app_user_id', 'organizer_user_id'];
const SUBSCRIPTION_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
]);

@Injectable()
export class StripeWebhookService {
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const endpointSecret = this.getEndpointSecret();
    try {
      return Stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
    } catch {
      throw new HttpException({ error: 'Invalid Stripe signature' }, 400);
    }
  }

  async handleEvent(event: Stripe.Event): Promise<HandleResult> {
    if (await getProcessedStripeWebhookEvent(event.id)) {
      return { duplicate: true, handled: false };
    }

    const handled = await this.dispatch(event);
    await recordProcessedStripeWebhookEvent({
      eventId: event.id,
      type: event.type,
      stripeCreated: event.created,
    });
    return { duplicate: false, handled };
  }

  private async dispatch(event: Stripe.Event): Promise<boolean> {
    if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
      await this.applySubscription(event.data.object as StripeSubscriptionLike);
      return true;
    }

    switch (event.type) {
      case 'customer.created':
      case 'customer.updated':
        return this.applyCustomer(event.data.object as Stripe.Customer);
      case 'customer.deleted':
        return this.applyDeletedCustomer(event.data.object as unknown as Stripe.DeletedCustomer);
      case 'invoice.payment_failed':
        return this.applyInvoicePaymentFailed(event.data.object as StripeInvoiceLike);
      default:
        return false;
    }
  }

  private async applyCustomer(customer: Stripe.Customer): Promise<boolean> {
    if (!customer.id) return false;
    const userId = await this.userIdFromMetadata(customer.metadata);
    if (!userId) return false;
    await upsertBillingCustomer(userId, customer.id);
    return true;
  }

  private async applyDeletedCustomer(customer: Stripe.DeletedCustomer): Promise<boolean> {
    if (!customer.id) return false;
    return (await markStripeCustomerSubscriptionsCanceled(customer.id)) > 0;
  }

  private async applySubscription(subscription: StripeSubscriptionLike): Promise<void> {
    const stripeCustomerId = stripeId(subscription.customer);
    if (!stripeCustomerId) {
      throw new HttpException({ error: 'Stripe subscription is missing a customer id' }, 422);
    }

    const userId = await this.resolveSubscriptionUserId(subscription, stripeCustomerId);
    if (!userId) {
      throw new HttpException({ error: 'Unable to map Stripe subscription to a user' }, 422);
    }

    const firstItem = subscription.items?.data?.[0];
    const price = priceObject(firstItem?.price);

    await upsertStripeSubscriptionState({
      userId,
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      status: subscription.status || 'incomplete',
      planKey: planKeyFor(subscription.metadata, price),
      stripePriceId: price?.id ?? (typeof firstItem?.price === 'string' ? firstItem.price : null),
      currentPeriodStart: epochToIso(subscription.current_period_start ?? firstItem?.current_period_start),
      currentPeriodEnd: epochToIso(subscription.current_period_end ?? firstItem?.current_period_end),
      trialStart: epochToIso(subscription.trial_start),
      trialEnd: epochToIso(subscription.trial_end),
      cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
      canceledAt: epochToIso(subscription.canceled_at),
    });
  }

  private async applyInvoicePaymentFailed(invoice: StripeInvoiceLike): Promise<boolean> {
    const subscription = subscriptionFromInvoice(invoice);
    if (!subscription) return false;
    if (typeof subscription !== 'string') {
      await this.applySubscription(subscription);
      return true;
    }

    const updated = await markStripeSubscriptionPaymentFailed(subscription);
    return !!updated;
  }

  private async resolveSubscriptionUserId(
    subscription: StripeSubscriptionLike,
    stripeCustomerId: string,
  ): Promise<number | undefined> {
    return (
      (await getBillingUserIdByStripeSubscriptionId(subscription.id)) ??
      (await getBillingUserIdByStripeCustomerId(stripeCustomerId)) ??
      (await this.userIdFromMetadata(subscription.metadata)) ??
      (await this.userIdFromMetadata(customerMetadata(subscription.customer)))
    );
  }

  private async userIdFromMetadata(metadata: Metadata): Promise<number | undefined> {
    const userId = parseUserIdMetadata(metadata);
    if (!userId) return undefined;
    return (await userExists(userId)) ? userId : undefined;
  }

  private getEndpointSecret(): string {
    for (const key of STRIPE_WEBHOOK_SECRET_KEYS) {
      const value = process.env[key]?.trim();
      if (value) return value;
    }
    throw new HttpException({ error: 'Stripe webhook secret is not configured' }, 500);
  }
}

function stripeId(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function customerMetadata(value: StripeSubscriptionLike['customer']): Metadata {
  if (!value || typeof value === 'string') return undefined;
  return value.metadata;
}

function parseUserIdMetadata(metadata: Metadata): number | undefined {
  if (!metadata) return undefined;
  for (const key of USER_ID_METADATA_KEYS) {
    const raw = metadata[key]?.trim();
    if (!raw) continue;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function priceObject(price: StripeSubscriptionItemLike['price']): StripePriceLike | null {
  if (!price || typeof price === 'string') return null;
  return price;
}

function planKeyFor(metadata: Metadata, price: StripePriceLike | null): string {
  return (
    metadata?.plan_key?.trim() ||
    metadata?.trippi_plan_key?.trim() ||
    price?.metadata?.plan_key?.trim() ||
    price?.lookup_key?.trim() ||
    price?.nickname?.trim() ||
    price?.id ||
    'free'
  );
}

function epochToIso(value: number | null | undefined): string | null {
  if (typeof value !== 'number') return null;
  return new Date(value * 1000).toISOString();
}

function subscriptionFromInvoice(invoice: StripeInvoiceLike): string | StripeSubscriptionLike | null {
  const direct = invoice.subscription;
  if (direct) return direct;

  const parentSubscription = invoice.parent?.subscription_details?.subscription;
  if (parentSubscription) return parentSubscription;

  for (const line of invoice.lines?.data ?? []) {
    const lineSubscription =
      line.parent?.subscription_item_details?.subscription ?? line.parent?.invoice_item_details?.subscription;
    if (lineSubscription) return lineSubscription;
  }

  return null;
}
