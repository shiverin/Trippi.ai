import { CollabController } from './collab.controller';
import { CollabService } from './collab.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [CollabController],
  providers: [CollabService],
})
export class CollabModule {}
