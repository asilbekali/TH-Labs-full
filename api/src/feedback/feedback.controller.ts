import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
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
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { ListFeedbackDto } from './dto/list-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /**
   * The app's feedback box posts here.
   *
   * With a bearer token the body is just `{ message }`: the server reads the
   * name and email off the account and stamps the row with the user id, and
   * `createdAt` is the database's own clock. Without one, `name` and `email`
   * have to be in the body — see FeedbackService.create.
   *
   * OptionalJwtAuthGuard rather than JwtAuthGuard: the route stays reachable
   * signed out, and an expired token costs someone a bug report rather than
   * bouncing them. The guard never refuses — see its docblock for why that
   * means it must never protect anything.
   */
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Leave feedback',
    description:
      'Signed in, post only `message` — name, email and the account id are ' +
      'taken from the token. Signed out, `name` and `email` are required. ' +
      'Messages land in the admin panel inbox (GET /v1/feedback).',
  })
  create(
    @Body() createFeedbackDto: CreateFeedbackDto,
    @Req() req: { user?: AuthenticatedUser },
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.feedbackService.create(createFeedbackDto, req.user, userAgent);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List feedback (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  findAll(@Query() query: ListFeedbackDto) {
    return this.feedbackService.findAll(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get one feedback message (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.feedbackService.findOne(id);
  }

  // Triage only — status and a private note. The sender's words are not
  // editable; see UpdateFeedbackDto.
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Triage a feedback message (ADMIN and SUPERADMIN)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateFeedbackDto: UpdateFeedbackDto,
  ) {
    return this.feedbackService.update(id, updateFeedbackDto);
  }

  // Destructive, so SUPERADMIN only — same split as Community. Normal triage
  // ends at RESOLVED or SPAM; delete is for genuine spam, not for tidying.
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a feedback message (SUPERADMIN only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPERADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.feedbackService.remove(id);
  }
}
