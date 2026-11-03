import { Module } from '@nestjs/common';
import { DubIssuesController } from './dub-issues.controller';

@Module({
  controllers: [DubIssuesController],
})
export class DubIssuesModule {}
