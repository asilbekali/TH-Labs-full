import { Module } from '@nestjs/common';

import { PaymentModule } from '../payment/payment.module';
import { EditorController } from './editor.controller';
import { EditorService } from './editor.service';

@Module({
  imports: [PaymentModule],
  controllers: [EditorController],
  providers: [EditorService],
})
export class EditorModule {}
