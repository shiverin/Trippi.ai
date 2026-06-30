import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeClient } from './stripe-client';
import { Module } from '@nestjs/common';

@Module({
  controllers: [BillingController],
  providers: [BillingService, StripeClient],
})
export class BillingModule {}
