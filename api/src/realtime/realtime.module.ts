import { Module } from '@nestjs/common';

import { PaymentModule } from '../payment/payment.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

// PrismaService and ConfigService come from global modules.
@Module({
  imports: [PaymentModule],
  controllers: [RealtimeController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
