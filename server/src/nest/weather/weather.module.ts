import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';
import { Module } from '@nestjs/common';

/** Weather domain (pilot leaf module). Registered in AppModule. */
@Module({
  controllers: [WeatherController],
  providers: [WeatherService],
})
export class WeatherModule {}
