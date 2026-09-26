import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AuditService } from './audit.service';

// The audit table only ever grows, and it grows per request. Left alone it
// becomes the largest table in the database and the feed's own queries slow
// down with it.
//
// AUDIT_LOG_RETENTION_DAYS (default 90) is the window kept. Set it to match
// whatever retention the business actually needs — deleting is irreversible,
// so err long.
@Injectable()
export class AuditCron {
  private readonly logger = new Logger(AuditCron.name);

  constructor(private readonly audit: AuditService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldEntries(): Promise<number> {
    const days = this.audit.retentionDays;
    try {
      const count = await this.audit.prune(days);
      if (count > 0) {
        this.logger.log(
          `Pruned ${count} audit entries older than ${days} days`,
        );
      }
      return count;
    } catch (err) {
      this.logger.error(
        `Audit prune failed: ${err instanceof Error ? err.message : err}`,
      );
      return 0;
    }
  }
}
