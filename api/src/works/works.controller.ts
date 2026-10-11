import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SaveWorkDto } from './dto/save-work.dto';
import { WorksService } from './works.service';

/**
 * The signed-in user's My Works library, so it follows the account across
 * browsers and devices instead of staying in the one that ran the dub.
 */
@ApiTags('works')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('works')
export class WorksController {
  constructor(private readonly worksService: WorksService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's dubs, newest first" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.worksService.list(user.id);
  }

  @Put(':jobId')
  @ApiOperation({ summary: 'Save (create or replace) one dub in the library' })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
    @Body() dto: SaveWorkDto,
  ) {
    return this.worksService.save(user.id, jobId, dto.work);
  }

  @Delete(':jobId')
  @ApiOperation({ summary: 'Remove one dub from the library' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
  ) {
    return this.worksService.remove(user.id, jobId);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the library' })
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.worksService.clear(user.id);
  }
}
