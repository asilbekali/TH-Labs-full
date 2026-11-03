import { Global, Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';

@Global()
@Module({
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
