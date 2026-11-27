import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StartSessionDto } from './dto/start-session.dto';
import { RealtimeService } from './realtime.service';

@ApiTags('realtime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Post('session')
  @ApiOperation({
    summary: 'Start a live translation session',
    description:
      'Mints a one-use Gemini Live Translate token locked to the target ' +
      'language. Uses the one-time free trial first, then charges tokens ' +
      'for the granted seconds. The browser opens `wsUrl` itself; no audio ' +
      'passes through this API. 402 when neither the trial nor the ' +
      'balance covers a session, 503 when no Gemini key is configured.',
  })
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartSessionDto) {
    return this.realtime.startSession(user.id, dto.targetLanguage, user.email);
  }

  @Get('usage')
  @ApiOperation({
    summary: 'Free trial left, token balance, and the minutes it buys',
  })
  usage(@CurrentUser() user: AuthenticatedUser) {
    return this.realtime.usage(user.id, user.email);
  }
}
