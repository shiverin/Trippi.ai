import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [PhotosController],
  providers: [PhotosService],
})
export class PhotosModule {}
