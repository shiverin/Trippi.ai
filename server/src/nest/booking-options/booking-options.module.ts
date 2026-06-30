import { BookingOptionsController } from './booking-options.controller';
import { BookingOptionsService } from './booking-options.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [BookingOptionsController],
  providers: [BookingOptionsService],
})
export class BookingOptionsModule {}
