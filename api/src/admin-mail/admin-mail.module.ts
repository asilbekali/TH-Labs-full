import { Module } from '@nestjs/common';
import { AdminMailController } from './admin-mail.controller';
import { AdminMailService } from './admin-mail.service';

// MailService comes from the global MailModule — nothing to import.
@Module({
  controllers: [AdminMailController],
  providers: [AdminMailService],
})
export class AdminMailModule {}
