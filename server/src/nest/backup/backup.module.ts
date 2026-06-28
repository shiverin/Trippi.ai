import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
