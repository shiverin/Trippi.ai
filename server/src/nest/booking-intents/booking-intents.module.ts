import { BookingIntentsController } from './booking-intents.controller';
import { BookingIntentsService } from './booking-intents.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [BookingIntentsController],
  providers: [BookingIntentsService],
})
export class BookingIntentsModule {}
