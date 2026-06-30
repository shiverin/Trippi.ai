import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService],
})
export class BillingModule {}
