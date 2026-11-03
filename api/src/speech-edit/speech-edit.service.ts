import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, SpeechEdit, SpeechEditStatus } from '@prisma/client';
import * as path from 'node:path';

import { MediaService } from '../media/media.service';
import { PaymentService } from '../payment/payment.service';
import {
  PipelineService,
  type PipelineSegment,
} from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyEdits,
  planSplice,
  spliceArgs,
  type LineEdit,
  type SpokenLine,
} from './edits';

const ACTIVE: SpeechEditStatus[] = [
  SpeechEditStatus.QUEUED,
  SpeechEditStatus.RUNNING,
];

/**
 * The speech editor (Studio Max): correct a line of a finished dub and re-dub
 * ONLY that line, leaving the rest of the video untouched.
 *
 * The dubbing pipeline is not changed for this. Each corrected line is spoken
 * by the pipeline's own text-to-speech (POST /api/tts, billed there like any
 * speech), then ffmpeg here silences the stretch the old line owned and lays
 * the new one in, copying the picture as-is. Every edit is a new version built
 * on the previous one, so corrections stack and each version stays playable.
 *
 * One honest limit, said in the UI too: the corrected line is spoken by the
 * text-to-speech voice for its language, not a clone of the original speaker
 * — cloning lives inside the dubbing run, which is the AI service's business.
 */
@Injectable()
export class SpeechEditService implements OnModuleInit {
  private readonly logger = new Logger(SpeechEditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly pipeline: PipelineService,
    private readonly media: MediaService,
  ) {}

  /** An edit that was running when the process stopped will never finish. */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.speechEdit.updateMany({
        where: { status: { in: ACTIVE } },
        data: {
          status: SpeechEditStatus.FAILED,
          error: 'The server restarted during this edit. Apply it again.',
        },
      });
    } catch (error) {
      // A database without this table yet must not stop the API booting.
      this.logger.warn(
        `could not settle interrupted speech edits: ${
          error instanceof Error ? error.message.split('\n')[0] : error
        }`,
      );
    }
  }

  private view(row: SpeechEdit) {
    return {
      id: row.id,
      jobId: row.jobId,
      version: row.version,
      status: row.status,
      message: row.message,
      error: row.error,
      changed: row.changed as number[],
      segments: row.segments as unknown as PipelineSegment[],
      outputUrl: row.outputPath ? this.media.urlFor(row.outputPath) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Every version of this dub's speech, newest first. */
  async list(userId: number, jobId: string) {
    const rows = await this.prisma.speechEdit.findMany({
      where: { userId, jobId },
      orderBy: { version: 'desc' },
      take: 50,
    });
    return { versions: rows.map((r) => this.view(r)) };
  }

  async create(
    userId: number,
    token: string,
    jobId: string,
    edits: LineEdit[],
  ) {
    await this.payments.assertTool(userId, 'speechEditor');
    const job = await this.pipeline.getJob(token, jobId);
    if (job.status !== 'completed' || !job.result.output_url) {
      throw new ConflictException(
        'Wait for the dub to finish before editing it.',
      );
    }

    const history = await this.prisma.speechEdit.findMany({
      where: { userId, jobId },
      orderBy: { version: 'desc' },
    });
    if (history.some((r) => ACTIVE.includes(r.status))) {
      throw new ConflictException(
        'An edit is already being applied to this dub.',
      );
    }
    // Build on the newest version that worked, or on the dub itself.
    const base = history.find(
      (r) => r.status === SpeechEditStatus.DONE && r.outputPath,
    );
    const baseSegments = base
      ? (base.segments as unknown as PipelineSegment[])
      : job.result.segments;
    if (!baseSegments.length) {
      throw new BadRequestException('This dub has no transcript to edit.');
    }
    const duration =
      job.result.duration ?? baseSegments[baseSegments.length - 1].end;

    const { segments, changed } = applyEdits(baseSegments, edits, duration);
    if (!changed.length) {
      throw new BadRequestException(
        'None of the lines differ from the current dub.',
      );
    }

    const row = await this.prisma.speechEdit.create({
      data: {
        userId,
        jobId,
        version: (history[0]?.version ?? 0) + 1,
        segments: segments as unknown as Prisma.InputJsonValue,
        changed,
        message: 'Waiting to start',
      },
    });

    // Runs after the response: speaking a few lines takes seconds to minutes,
    // and the page polls GET /speech-edits/:jobId for the outcome.
    void this.process(row, token, {
      language: job.options.target_lang,
      before: baseSegments,
      after: segments,
      changed,
      duration,
      basePath: base?.outputPath ?? null,
      pipelineVideo: job.result.output_url,
    });
    return this.view(row);
  }

  private async process(
    row: SpeechEdit,
    token: string,
    ctx: {
      language: string;
      before: PipelineSegment[];
      after: PipelineSegment[];
      changed: number[];
      duration: number;
      basePath: string | null;
      pipelineVideo: string;
    },
  ): Promise<void> {
    const update = (data: Prisma.SpeechEditUpdateInput) =>
      this.prisma.speechEdit.update({ where: { id: row.id }, data });

    const dirRel = path.join('speech-edits', String(row.userId), row.jobId);
    const workRel = path.join(dirRel, `work-${this.media.newId()}`);
    try {
      await update({ status: SpeechEditStatus.RUNNING, message: 'Starting' });
      const work = await this.media.ensureDir(workRel);
      const { mutes, placements } = planSplice(
        ctx.before,
        ctx.after,
        ctx.changed,
        ctx.duration,
      );

      // The video this version builds on.
      let video: string;
      if (ctx.basePath) {
        video = this.media.resolve(ctx.basePath);
      } else {
        await update({ message: 'Fetching the dub' });
        video = path.join(work, 'base.mp4');
        await this.media.download(
          this.pipeline.mediaUrl(ctx.pipelineVideo),
          video,
        );
      }

      const spoken = placements.filter((p) => p.text);
      const lines: SpokenLine[] = [];
      for (const [i, p] of spoken.entries()) {
        await update({ message: `Voicing line ${i + 1} of ${spoken.length}` });
        const speech = await this.pipeline.speak(token, p.text, ctx.language);
        const file = path.join(
          work,
          `line-${p.id}${path.extname(speech.audioPath) || '.wav'}`,
        );
        await this.media.download(
          this.pipeline.mediaUrl(speech.audioPath),
          file,
        );
        const measured =
          (await this.media.probe(file)).duration || speech.duration;
        lines.push({ file, at: p.at, room: p.room, duration: measured });
      }

      await update({ message: 'Rendering the new version' });
      const outRel = path.join(
        dirRel,
        `v${row.version}-${this.media.newId()}.mp4`,
      );
      await this.media.ensureDir(dirRel);
      await this.media.ffmpeg(
        spliceArgs(
          video,
          mutes,
          lines,
          this.media.resolve(outRel),
          (await this.media.probe(video)).audioChannels || 2,
        ),
        'splice the edited lines into the dub',
      );
      const cleared = placements.length - spoken.length;
      await update({
        status: SpeechEditStatus.DONE,
        outputPath: outRel,
        message: cleared
          ? `${cleared} line${cleared > 1 ? 's' : ''} cleared and left silent`
          : null,
      });
      this.logger.log(
        `speech edit ${row.id}: job ${row.jobId} v${row.version}, lines ${ctx.changed.join(',')}`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The edit could not be applied.';
      this.logger.error(`speech edit ${row.id} failed: ${message}`);
      await update({
        status: SpeechEditStatus.FAILED,
        error: message.slice(0, 300),
        message: null,
      }).catch(() => undefined);
    } finally {
      await this.media.remove(workRel).catch(() => undefined);
    }
  }
}
