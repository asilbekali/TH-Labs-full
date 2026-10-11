import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

// Generous for a dub's transcript and a ~15 KB poster, small enough that the
// library cannot be used as general-purpose storage.
const MAX_WORK_BYTES = 1_500_000;
// A library page is the whole library. Nobody has run this many dubs, and the
// cap keeps one response bounded if somebody does.
const MAX_LIST = 500;

@Injectable()
export class WorksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number) {
    const rows = await this.prisma.work.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_LIST,
      select: { data: true },
    });
    return rows.map((r) => r.data);
  }

  /** Create or replace one record. Idempotent, so a retried save is harmless. */
  async save(userId: number, jobId: string, work: Record<string, unknown>) {
    if (work.id !== jobId) {
      throw new BadRequestException(
        'work.id must match the job id in the path',
      );
    }
    if (JSON.stringify(work).length > MAX_WORK_BYTES) {
      throw new BadRequestException('Work record is too large');
    }
    const data = work as Prisma.InputJsonObject;
    await this.prisma.work.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId, data },
      update: { data },
    });
    return { ok: true };
  }

  async remove(userId: number, jobId: string) {
    // deleteMany, not delete: removing a dub that is already gone (deleted on
    // another device first) is the outcome the caller wanted, not a 404.
    await this.prisma.work.deleteMany({ where: { userId, jobId } });
    return { ok: true };
  }

  async clear(userId: number) {
    const { count } = await this.prisma.work.deleteMany({ where: { userId } });
    return { ok: true, deleted: count };
  }
}
