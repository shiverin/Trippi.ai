import { FilesDownloadController } from './files-download.controller';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [FilesController, FilesDownloadController],
  providers: [FilesService],
})
export class FilesModule {}
