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
import { AdminMailModule } from './admin-mail/admin-mail.module';
import { CommunityModule } from './community/community.module';
import { FeedbackModule } from './feedback/feedback.module';
import { PaymentModule } from './payment/payment.module';
import { LanguagesModule } from './languages/languages.module';
import { HealthModule } from './health/health.module';
import { PriceTokenModule } from './price-token/price-token.module';
import { AuditModule } from './audit/audit.module';
import { WorksModule } from './works/works.module';
import { MediaModule } from './media/media.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { SpeechEditModule } from './speech-edit/speech-edit.module';
import { DubIssuesModule } from './dub-issues/dub-issues.module';
import { EditorModule } from './editor/editor.module';

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
    // Same reason as AuditModule: `/admin/mail` must register before
    // AdminController's `/admin/:id`.
    AdminMailModule,
    AdminModule,
    CommunityModule,
    FeedbackModule,
    PaymentModule,
    LanguagesModule,
    HealthModule,
    PriceTokenModule,
    WorksModule,
    MediaModule,
    PipelineModule,
    SpeechEditModule,
    DubIssuesModule,
    EditorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
