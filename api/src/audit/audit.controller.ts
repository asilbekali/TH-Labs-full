import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLog, Role } from '@prisma/client';
import { map, Observable } from 'rxjs';

import { AuditService } from './audit.service';
import { AuditQueryDto, AuditStatsDto } from './dto/audit-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

// The activity feed behind the admin panel: who did what, when, and whether it
// worked.
//
// Read-only by design. Nothing here can edit or delete a row — an audit trail
// that staff can edit is not an audit trail. Pruning is the retention cron's
// job alone (audit.cron.ts).
//
// ADMIN and SUPERADMIN only; RolesGuard already treats SUPERADMIN as
// satisfying ADMIN.
@ApiTags('admin-logs')
@ApiBearerAuth()
@Controller('admin/logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Activity feed — filter by actor, action, method, result, date range',
  })
  list(@Query() q: AuditQueryDto) {
    return this.audit.list(q);
  }

  @Get('stats')
  @ApiOperation({
    summary:
      'Counts bucketed by second/minute/hour/day, plus busiest actors and actions',
  })
  stats(@Query() q: AuditStatsDto) {
    return this.audit.stats(q);
  }

  @Get('actions')
  @ApiOperation({ summary: 'Distinct action names, for a filter dropdown' })
  async actions() {
    return { actions: await this.audit.actions() };
  }

  // Server-sent events: the panel opens this once and rows arrive as they are
  // written, so "watching what is happening right now" costs one connection
  // rather than a poll every second.
  //
  // EventSource cannot set an Authorization header, so a browser calling this
  // directly needs the token as a query parameter or a proxy that adds it —
  // worth knowing before wiring up the panel.
  @Sse('stream')
  @ApiOperation({ summary: 'Live feed of new rows (SSE)' })
  stream(): Observable<{ data: AuditLog }> {
    return this.audit.watch().pipe(map((row) => ({ data: row })));
  }

  // Last, so it cannot swallow /stats, /actions or /stream.
  @Get(':id')
  @ApiOperation({ summary: 'One row, with its full redacted request detail' })
  async findOne(@Param('id') id: string) {
    const row = await this.audit.findOne(id);
    if (!row) throw new NotFoundException('Audit entry not found.');
    return row;
  }
}
