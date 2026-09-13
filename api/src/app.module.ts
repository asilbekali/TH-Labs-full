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
import { PaymentModule } from './payment/payment.module';
import { LanguagesModule } from './languages/languages.module';
import { HealthModule } from './health/health.module';
import { PriceTokenModule } from './price-token/price-token.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PrismaModule,
    LoggerModule,
    MailModule,
    UsersModule,
    AuthModule,
    AdminModule,
    CommunityModule,
    PaymentModule,
    LanguagesModule,
    HealthModule,
    PriceTokenModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
