import { AtlasController } from './atlas.controller';
import { AtlasService } from './atlas.service';
import { Module } from '@nestjs/common';

/** Atlas addon domain (L7 leaf module). Registered in AppModule. */
@Module({
  controllers: [AtlasController],
  providers: [AtlasService],
})
export class AtlasModule {}
