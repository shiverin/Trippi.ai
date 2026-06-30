import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeClient } from './stripe-client';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService, StripeClient, StripeWebhookService],
})
export class BillingModule {}
