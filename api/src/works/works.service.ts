import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as path from 'node:path';

import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';

// Generous for a dub's transcript and a ~15 KB poster, small enough that the
// library cannot be used as general-purpose storage.
const MAX_WORK_BYTES = 1_500_000;
// A library page is the whole library. Nobody has run this many dubs, and the
// cap keeps one response bounded if somebody does.
const MAX_LIST = 500;
// A pipeline job id. It names a folder on disk, so nothing else gets near rm.
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Where the speech editor writes its versions (see speech-edit.service.ts).
const speechEditDir = (userId: number, jobId?: string) =>
  jobId
    ? path.join('speech-edits', String(userId), jobId)
    : path.join('speech-edits', String(userId));

@Injectable()
export class WorksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

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

  /**
   * Delete one dub for good: its library record, every speech-editor version
   * of it, and the videos those versions wrote. Nothing of it is kept.
   */
  async remove(userId: number, jobId: string) {
    if (!JOB_ID.test(jobId)) throw new BadRequestException('Bad job id');
    // deleteMany, not delete: removing a dub that is already gone (deleted on
    // another device first) is the outcome the caller wanted, not a 404.
    await this.prisma.$transaction([
      this.prisma.speechEdit.deleteMany({ where: { userId, jobId } }),
      this.prisma.work.deleteMany({ where: { userId, jobId } }),
    ]);
    await this.media.remove(speechEditDir(userId, jobId));
    return { ok: true };
  }

  async clear(userId: number) {
    const [, { count }] = await this.prisma.$transaction([
      this.prisma.speechEdit.deleteMany({ where: { userId } }),
      this.prisma.work.deleteMany({ where: { userId } }),
    ]);
    await this.media.remove(speechEditDir(userId));
    return { ok: true, deleted: count };
  }
}
