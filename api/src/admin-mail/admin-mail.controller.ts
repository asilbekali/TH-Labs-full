import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminMailService } from './admin-mail.service';
import { SendAdminMailDto } from './dto/send-admin-mail.dto';

// Staff writing to users from the admin panel — replies to feedback, or a
// note to a hand-picked group. Both ADMIN and SUPERADMIN: replying to people
// is everyday support work, not a privileged action.
@ApiTags('admin-mail')
@Controller('admin/mail')
export class AdminMailController {
  constructor(private readonly adminMail: AdminMailService) {}

  @Post()
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Email one or more users from the admin panel (ADMIN and SUPERADMIN)',
    description:
      'Sends one branded email per recipient. Answers `{ total, sent, failed[] }`; ' +
      '503 when SMTP is not configured on this deploy.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  send(@Body() dto: SendAdminMailDto) {
    return this.adminMail.send(dto);
  }
}
