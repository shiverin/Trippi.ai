import { TripShareController, SharedController } from './share.controller';
import { ShareService } from './share.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [TripShareController, SharedController],
  providers: [ShareService],
})
export class ShareModule {}
