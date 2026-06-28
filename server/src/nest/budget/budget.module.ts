import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { Module } from '@nestjs/common';

/** Budget domain (S4 — Phase 2 trip sub-domain). Registered in AppModule. */
@Module({
  controllers: [BudgetController],
  providers: [BudgetService],
})
export class BudgetModule {}
