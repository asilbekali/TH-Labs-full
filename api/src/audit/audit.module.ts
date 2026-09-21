import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { AuditTargetResolver } from './audit.target';
import { AuditCron } from './audit.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

// Global so AuditService can be injected anywhere a handler wants to record
// something the HTTP shape alone does not capture, and APP_INTERCEPTOR so
// every route is covered without each module opting in — an audit log you
// have to remember to switch on is one that will have gaps.
@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditTargetResolver,
    AuditCron,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
