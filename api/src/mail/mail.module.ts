import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

// Global so any module can inject MailService without importing MailModule —
// same pattern as LoggerModule and PrismaModule.
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
