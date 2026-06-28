import { JourneyAddonGuard } from './journey-addon.guard';
import { JourneyPublicController } from './journey-public.controller';
import { JourneyController } from './journey.controller';
import { JourneyService } from './journey.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [JourneyController, JourneyPublicController],
  providers: [JourneyService, JourneyAddonGuard],
})
export class JourneyModule {}
