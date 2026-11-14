import { Module } from '@nestjs/common';

import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

// PrismaService and ConfigService come from global modules.
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
