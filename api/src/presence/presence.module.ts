import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

// PrismaService comes from the global PrismaModule — nothing to import.
@Module({
  controllers: [PresenceController],
  providers: [PresenceService],
})
export class PresenceModule {}
