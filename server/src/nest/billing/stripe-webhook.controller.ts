import { StripeWebhookService } from './stripe-webhook.service';
import { Controller, Headers, HttpCode, HttpException, Post, Req } from '@nestjs/common';

import type { Request } from 'express';

interface RawBodyRequest extends Request {
  body: Buffer | unknown;
}

@Controller('api/billing/stripe/webhook')
export class StripeWebhookController {
  constructor(private readonly stripeWebhook: StripeWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest, @Headers('stripe-signature') signature?: string | string[]) {
    if (!signature || Array.isArray(signature)) {
      throw new HttpException({ error: 'Missing Stripe signature' }, 400);
    }
    if (!Buffer.isBuffer(req.body)) {
      throw new HttpException({ error: 'Missing raw Stripe webhook body' }, 400);
    }

    const event = this.stripeWebhook.constructEvent(req.body, signature);
    const result = await this.stripeWebhook.handleEvent(event);
    return { received: true, ...result };
  }
}
