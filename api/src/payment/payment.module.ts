import { Module } from '@nestjs/common';

import { PaymentController } from './payment.controller';
import { AdminBillingController } from './admin-billing.controller';
import { PaymentService } from './payment.service';
import { AdminBillingService } from './admin-billing.service';
import { DodoService } from './dodo.service';
import { DodoProvider } from './dodo.provider';
import { DodoWebhookHandler } from './webhook.handler';
import { PaymentCron } from './payment.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PaymentController, AdminBillingController],
  providers: [
    PaymentService,
    AdminBillingService,
    DodoService,
    DodoProvider,
    DodoWebhookHandler,
    PaymentCron,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
