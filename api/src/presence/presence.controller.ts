import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { PresenceService } from './presence.service';

@ApiTags('presence')
@Controller()
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /**
   * Every open tab on th-labs.uz and in the Studio beats here — on each
   * navigation (`pageview: true`) and every 20s while it stays open.
   *
   * Public, so the landing page can count anonymous visitors. With a token the
   * beat is attached to the account; OptionalJwtAuthGuard means an expired
   * token just makes it anonymous rather than failing. Never audited — see
   * isAuditable.
   */
  @Post('presence')
  @HttpCode(204)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Report which page this browser is on' })
  async beat(
    @Body() dto: HeartbeatDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    await this.presence.beat(dto, req.user);
  }

  @Get('admin/city')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Live presence and today’s numbers for Agent City (ADMIN and SUPERADMIN)',
    description:
      '`from` is the start of "today" as the caller sees it (ISO). Defaults to ' +
      'UTC midnight.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  city(@Query('from') from?: string) {
    const parsed = from ? new Date(from) : null;
    const start =
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed
        : new Date(new Date().toISOString().slice(0, 10));
    return this.presence.city(start);
  }
}
