import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { Module } from '@nestjs/common';

/** Tags domain (L5 leaf module). Registered in AppModule. */
@Module({
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
