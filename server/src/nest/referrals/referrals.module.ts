import { ReferralsController } from './referrals.controller';
import { Module } from '@nestjs/common';

@Module({
  controllers: [ReferralsController],
})
export class ReferralsModule {}
