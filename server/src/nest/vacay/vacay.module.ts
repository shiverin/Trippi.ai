import { VacayController } from './vacay.controller';
import { VacayService } from './vacay.service';
import { Module } from '@nestjs/common';

/** Vacay addon domain (S1 — Phase 2 trip sub-domain). Registered in AppModule. */
@Module({
  controllers: [VacayController],
  providers: [VacayService],
})
export class VacayModule {}
