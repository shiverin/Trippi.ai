import { AirportsController } from './airports.controller';
import { AirportsService } from './airports.service';
import { Module } from '@nestjs/common';

/** Airports domain (L2 leaf module). Registered in AppModule. */
@Module({
  controllers: [AirportsController],
  providers: [AirportsService],
})
export class AirportsModule {}
