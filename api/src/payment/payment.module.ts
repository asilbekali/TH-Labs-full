import { Module } from '@nestjs/common';

import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { StripeService } from './stripe.service';
import { StripeProvider } from './stripe.provider';
import { StripeWebhookHandler } from './webhook.handler';
import { PaymentCron } from './payment.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    StripeService,
    StripeProvider,
    StripeWebhookHandler,
    PaymentCron,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
