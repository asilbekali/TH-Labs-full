import { Module } from '@nestjs/common';

import { PaymentModule } from '../payment/payment.module';
import { SpeechEditController } from './speech-edit.controller';
import { SpeechEditService } from './speech-edit.service';

@Module({
  imports: [PaymentModule],
  controllers: [SpeechEditController],
  providers: [SpeechEditService],
})
export class SpeechEditModule {}
