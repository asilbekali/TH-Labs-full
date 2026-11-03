import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { BearerToken } from '../common/decorators/bearer-token.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PipelineService } from '../pipeline/pipeline.service';
import { analyse } from './issues';

@ApiTags('dub-issues')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dub-issues')
export class DubIssuesController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get(':jobId')
  @ApiOperation({
    summary:
      'What went wrong in one of your dubs, and how to fix it (every plan)',
  })
  async issues(@BearerToken() token: string, @Param('jobId') jobId: string) {
    const job = await this.pipeline.getJob(token, jobId);
    return { jobId, issues: analyse(job) };
  }
}
