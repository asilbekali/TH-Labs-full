import { Global, Module } from '@nestjs/common';
import { MediaService } from './media.service';

@Global()
@Module({
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
