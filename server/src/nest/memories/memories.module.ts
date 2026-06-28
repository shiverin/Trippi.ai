import { ImmichMemoriesController } from './immich.controller';
import { MemoriesService } from './memories.service';
import { SynologyMemoriesController } from './synology.controller';
import { UnifiedMemoriesController } from './unified.controller';
import { Module } from '@nestjs/common';

/**
 * Memories (photo-providers) domain — mounted at /api/integrations/memories.
 *
 * Ports the legacy Express router (routes/memories/unified.ts, which composes
 * immich.ts + synology.ts) to Nest, reusing services/memories/* unchanged. No
 * module-level addon gate — enablement is per-provider-row inside the services,
 * exactly as the legacy mount had it.
 */
@Module({
  controllers: [UnifiedMemoriesController, ImmichMemoriesController, SynologyMemoriesController],
  providers: [MemoriesService],
})
export class MemoriesModule {}
