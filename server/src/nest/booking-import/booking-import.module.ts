import { BookingImportController } from './booking-import.controller';
import { BookingImportService } from './booking-import.service';
import { FeaturesController } from './features.controller';
import { KitineraryExtractorService } from './kitinerary-extractor.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [BookingImportController, FeaturesController],
  providers: [BookingImportService, KitineraryExtractorService],
})
export class BookingImportModule {}
