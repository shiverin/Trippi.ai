import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
