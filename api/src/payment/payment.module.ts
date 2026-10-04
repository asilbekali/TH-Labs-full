import { Module } from '@nestjs/common';

import { PaymentController } from './payment.controller';
import { AdminBillingController } from './admin-billing.controller';
import { PaymentService } from './payment.service';
import { AdminBillingService } from './admin-billing.service';
import { LemonSqueezyService } from './lemonsqueezy.service';
import { PaymentCron } from './payment.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

// No webhook handler and no provider SDK — LemonSqueezyService is a small
// fetch client that reads orders, subscriptions and invoices back from LS. See
// lemonsqueezy.service.ts for why that read is the whole trust boundary.
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PaymentController, AdminBillingController],
  providers: [PaymentService, AdminBillingService, LemonSqueezyService, PaymentCron],
  exports: [PaymentService],
})
export class PaymentModule {}
