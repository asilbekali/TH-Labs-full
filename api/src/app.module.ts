import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';

import { PrismaModule } from './prisma/prisma.module';
import { LoggerModule } from './common/logger/logger.module';
import { MailModule } from './mail/mail.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { CommunityModule } from './community/community.module';
import { FeedbackModule } from './feedback/feedback.module';
import { PaymentModule } from './payment/payment.module';
import { LanguagesModule } from './languages/languages.module';
import { HealthModule } from './health/health.module';
import { PriceTokenModule } from './price-token/price-token.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PrismaModule,
    LoggerModule,
    MailModule,
    UsersModule,
    AuthModule,
    // Before AdminModule on purpose. AdminController owns `/admin/:id`, which
    // matches any single segment — including `/admin/logs`. Routes register in
    // module-import order, so importing the audit log first is what keeps its
    // paths reachable. Moving this line below AdminModule silently breaks the
    // activity feed.
    AuditModule,
    AdminModule,
    CommunityModule,
    FeedbackModule,
    PaymentModule,
    LanguagesModule,
    HealthModule,
    PriceTokenModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
