import { DecisionsController } from './decisions.controller';
import { DecisionsService } from './decisions.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [DecisionsController],
  providers: [DecisionsService],
})
export class DecisionsModule {}
