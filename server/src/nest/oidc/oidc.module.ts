import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [OidcController],
  providers: [OidcService],
})
export class OidcModule {}
