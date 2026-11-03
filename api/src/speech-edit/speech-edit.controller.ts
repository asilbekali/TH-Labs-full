import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { BearerToken } from '../common/decorators/bearer-token.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateSpeechEditDto } from './dto/create-speech-edit.dto';
import { SpeechEditService } from './speech-edit.service';

@ApiTags('speech-edits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('speech-edits')
export class SpeechEditController {
  constructor(private readonly edits: SpeechEditService) {}

  @Post()
  @ApiOperation({
    summary: 'Re-dub only the changed lines of a finished dub (Studio Max)',
    description:
      'Returns at once with the new version QUEUED; poll GET /speech-edits/:jobId. ' +
      'Each changed line is spoken by the pipeline text to speech (charged per ' +
      'second, like any speech) and spliced into the video.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @BearerToken() token: string,
    @Body() dto: CreateSpeechEditDto,
  ) {
    return this.edits.create(user.id, token, dto.jobId, dto.segments);
  }

  @Get(':jobId')
  @ApiOperation({
    summary: "Every speech-edit version of one of the caller's dubs",
  })
  list(@CurrentUser() user: AuthenticatedUser, @Param('jobId') jobId: string) {
    return this.edits.list(user.id, jobId);
  }
}
