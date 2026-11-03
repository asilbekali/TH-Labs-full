import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EditorProject, Prisma } from '@prisma/client';
import { copyFile, rename, rm } from 'node:fs/promises';
import * as path from 'node:path';

import { MediaService } from '../media/media.service';
import { PaymentService } from '../payment/payment.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma/prisma.service';
import { wordsToLines, type CaptionLine } from './captions';
import {
  defaultTracks,
  renderArgs,
  timelineLength,
  validateTracks,
  type Asset,
  type Track,
} from './timeline';

export interface RenderState {
  status: 'idle' | 'running' | 'done' | 'failed';
  progress: number;
  url: string | null;
  error: string | null;
  updatedAt: string | null;
}

/** An asset as the browser sees it: `file` is a server path and stays here. */
function publicAsset(asset: Asset): Omit<Asset, 'file'> {
  const copy: Asset = { ...asset };
  delete copy.file;
  return copy;
}

const IDLE: RenderState = {
  status: 'idle',
  progress: 0,
  url: null,
  error: null,
  updatedAt: null,
};

/**
 * The video editor (Studio Max). Projects are rows here; their media files
 * live under the data directory at editor/<user>/<project>/. The browser owns
 * the timeline; this validates it, stores it, and renders it with ffmpeg.
 *
 * Speech clips come from the pipeline's text to speech: the page makes the
 * speech (POST /api/tts, billed there) and asks this to import it by task id,
 * which is fetched with the user's own token so nobody can import another
 * user's speech. A finished dub can be imported the same way by job id.
 */
@Injectable()
export class EditorService implements OnModuleInit {
  private readonly logger = new Logger(EditorService.name);
  // Live render progress, kept off the database so a render does not write
  // the project row several times a second.
  private readonly renders = new Map<string, RenderState>();
  // One write at a time per project: two autosaves racing an upload would
  // otherwise lose one of them.
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly pipeline: PipelineService,
    private readonly media: MediaService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const running = await this.prisma.editorProject.findMany({
        where: { render: { path: ['status'], equals: 'running' } },
        select: { id: true },
      });
      for (const { id } of running) {
        await this.prisma.editorProject.update({
          where: { id },
          data: {
            render: {
              ...IDLE,
              status: 'failed',
              error: 'The server restarted during this export. Export again.',
              updatedAt: new Date().toISOString(),
            },
          },
        });
      }
    } catch (error) {
      this.logger.warn(
        `could not settle interrupted exports: ${
          error instanceof Error ? error.message.split('\n')[0] : error
        }`,
      );
    }
  }

  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn);
    // The queue holds a promise that never rejects. The caller gets `next`
    // and handles its error; if the bookkeeping chain carried the rejection
    // too, nothing would handle that copy and Node would take the whole
    // process down over one refused timeline.
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(id, settled);
    void settled.then(() => {
      if (this.locks.get(id) === settled) this.locks.delete(id);
    });
    return next;
  }

  private dirOf(userId: number, projectId: string): string {
    return path.join('editor', String(userId), projectId);
  }

  private assetsOf(p: EditorProject): Asset[] {
    return (p.assets as unknown as Asset[]) ?? [];
  }

  private view(p: EditorProject) {
    const live = this.renders.get(p.id);
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      // `file` is a server path; the browser gets the URL only.
      assets: this.assetsOf(p).map(publicAsset),
      tracks: p.tracks as unknown as Track[],
      render: live ?? { ...IDLE, ...(p.render as object) },
    };
  }

  private async own(userId: number, id: string): Promise<EditorProject> {
    const p = await this.prisma.editorProject.findFirst({
      where: { id, userId },
    });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private gate(userId: number) {
    return this.payments.assertTool(userId, 'videoEditor');
  }

  async list(userId: number) {
    await this.gate(userId);
    const rows = await this.prisma.editorProject.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return {
      projects: rows.map((p) => {
        const v = this.view(p);
        return {
          id: v.id,
          name: v.name,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          duration: Math.round(timelineLength(v.tracks) * 100) / 100,
          assets: v.assets.length,
          clips: v.tracks.reduce((n, t) => n + t.clips.length, 0),
          videoUrl: v.assets.find((a) => a.kind === 'video')?.url ?? null,
          render: v.render,
        };
      }),
    };
  }

  async create(userId: number, name?: string) {
    await this.gate(userId);
    const p = await this.prisma.editorProject.create({
      data: {
        userId,
        name: name?.trim() || 'Untitled project',
        tracks: defaultTracks(() =>
          this.media.newId(),
        ) as unknown as Prisma.InputJsonValue,
      },
    });
    return { project: this.view(p) };
  }

  async get(userId: number, id: string) {
    await this.gate(userId);
    return { project: this.view(await this.own(userId, id)) };
  }

  async update(
    userId: number,
    id: string,
    body: { name?: string; tracks?: unknown[] },
  ) {
    await this.gate(userId);
    return this.serial(id, async () => {
      const p = await this.own(userId, id);
      const data: Prisma.EditorProjectUpdateInput = {};
      if (body.name !== undefined) data.name = body.name.trim() || p.name;
      if (body.tracks !== undefined) {
        data.tracks = validateTracks(
          this.assetsOf(p),
          body.tracks,
        ) as unknown as Prisma.InputJsonValue;
      }
      const saved = await this.prisma.editorProject.update({
        where: { id },
        data,
      });
      return { project: this.view(saved) };
    });
  }

  async remove(userId: number, id: string) {
    await this.gate(userId);
    await this.own(userId, id);
    await this.prisma.editorProject.delete({ where: { id } });
    await this.media.remove(this.dirOf(userId, id));
    this.renders.delete(id);
    return { deleted: id };
  }

  /** Register a file already on disk (absolute `src`, moved or copied in). */
  private async addAsset(
    userId: number,
    id: string,
    src: string,
    name: string,
    source: Asset['source'],
    opts: { move: boolean; text?: string | null },
  ) {
    const ext = (
      path.extname(name) ||
      path.extname(src) ||
      '.bin'
    ).toLowerCase();
    const assetId = this.media.newId();
    const rel = path.join(
      this.dirOf(userId, id),
      'assets',
      `${assetId}${/^\.[a-z0-9]{1,6}$/.test(ext) ? ext : '.bin'}`,
    );
    await this.media.ensureDir(path.dirname(rel));
    const dest = this.media.resolve(rel);
    if (opts.move) await rename(src, dest);
    else await copyFile(src, dest);

    const info = await this.media.probe(dest);
    if (info.duration <= 0 || (!info.hasVideo && !info.hasAudio)) {
      await rm(dest, { force: true });
      throw new BadRequestException(
        'That file has no playable audio or video.',
      );
    }
    const asset: Asset = {
      id: assetId,
      kind: info.hasVideo ? 'video' : 'audio',
      name: name.slice(0, 120),
      url: this.media.urlFor(rel),
      duration: Math.round(info.duration * 1000) / 1000,
      has_audio: info.hasAudio,
      width: info.width,
      height: info.height,
      source,
      text: opts.text ?? null,
      peaks: info.hasAudio ? await this.media.peaks(dest, info.duration) : [],
      file: rel,
    };
    return this.serial(id, async () => {
      const p = await this.own(userId, id);
      const saved = await this.prisma.editorProject.update({
        where: { id },
        data: {
          assets: [
            ...this.assetsOf(p),
            asset,
          ] as unknown as Prisma.InputJsonValue,
        },
      });
      return { asset: publicAsset(asset), project: this.view(saved) };
    });
  }

  async upload(
    userId: number,
    id: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file)
      throw new BadRequestException('Send a file in the "file" field.');
    try {
      await this.gate(userId);
      await this.own(userId, id);
      return await this.addAsset(
        userId,
        id,
        file.path,
        file.originalname || 'media',
        'upload',
        {
          move: true,
        },
      );
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  async importAsset(
    userId: number,
    token: string,
    id: string,
    body: { ttsTaskId?: string; jobId?: string; name?: string; text?: string },
  ) {
    await this.gate(userId);
    await this.own(userId, id);
    let mediaPath: string;
    let name: string;
    let source: Asset['source'];
    if (body.ttsTaskId) {
      // Fetched with the caller's token: the pipeline answers 404 for a task
      // that is not theirs.
      const task = await this.pipeline.getSpeech(token, body.ttsTaskId);
      if (task.status !== 'done' || !task.audio_url) {
        throw new ConflictException('That speech is not ready yet.');
      }
      mediaPath = task.audio_url;
      name = body.name || 'Speech';
      source = 'tts';
    } else if (body.jobId) {
      const job = await this.pipeline.getJob(token, body.jobId);
      if (job.status !== 'completed' || !job.result.output_url) {
        throw new ConflictException('That dub has not finished.');
      }
      mediaPath = job.result.output_url;
      name = body.name || job.filename || 'Dubbed video';
      source = 'dub';
    } else {
      throw new BadRequestException('Send ttsTaskId or jobId.');
    }

    const tmpRel = path.join(
      'tmp',
      `${this.media.newId()}${path.extname(mediaPath) || '.bin'}`,
    );
    await this.media.ensureDir('tmp');
    const tmp = this.media.resolve(tmpRel);
    try {
      await this.media.download(this.pipeline.mediaUrl(mediaPath), tmp);
    } catch (error) {
      this.logger.warn(
        `import from pipeline failed: ${error instanceof Error ? error.message : error}`,
      );
      throw new GoneException('That file is no longer on the dubbing server.');
    }
    try {
      return await this.addAsset(
        userId,
        id,
        tmp,
        `${name}${path.extname(mediaPath)}`,
        source,
        {
          move: true,
          text: body.text ?? null,
        },
      );
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Subtitle lines for one file's speech, CapCut style: the AI service
   * (POST /api/transcribe) hears every word with its time, and the words are
   * grouped into short lines (captions.ts). Times are in the FILE's seconds;
   * the editor places them under each clip of the file.
   */
  async subtitles(
    userId: number,
    token: string,
    id: string,
    assetId: string,
    language = 'auto',
  ): Promise<{ assetId: string; language: string; lines: CaptionLine[] }> {
    await this.gate(userId);
    const p = await this.own(userId, id);
    const asset = this.assetsOf(p).find((a) => a.id === assetId);
    if (!asset?.file) throw new NotFoundException('File not found');
    if (!asset.has_audio) {
      throw new BadRequestException(
        'That file has no sound to make subtitles from.',
      );
    }
    // Only the speech travels: 16 kHz mono, a few hundred KB a minute.
    await this.media.ensureDir('tmp');
    const wavRel = path.join('tmp', `${this.media.newId()}.wav`);
    try {
      await this.media.ffmpeg(
        [
          '-i',
          this.media.resolve(asset.file),
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          this.media.resolve(wavRel),
        ],
        'extract the sound for subtitles',
      );
      const heard = await this.pipeline.transcribe(
        token,
        this.media.resolve(wavRel),
        language,
      );
      return {
        assetId,
        language: heard.language,
        lines: wordsToLines(heard.words),
      };
    } finally {
      await this.media.remove(wavRel).catch(() => undefined);
    }
  }

  async removeAsset(userId: number, id: string, assetId: string) {
    await this.gate(userId);
    return this.serial(id, async () => {
      const p = await this.own(userId, id);
      const assets = this.assetsOf(p);
      const asset = assets.find((a) => a.id === assetId);
      if (!asset) throw new NotFoundException('File not found');
      const tracks = p.tracks as unknown as Track[];
      if (tracks.some((t) => t.clips.some((c) => c.asset_id === assetId))) {
        throw new ConflictException(
          'Remove the clips that use this file first.',
        );
      }
      const saved = await this.prisma.editorProject.update({
        where: { id },
        data: {
          assets: assets.filter(
            (a) => a.id !== assetId,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      if (asset.file) await this.media.remove(asset.file);
      return { project: this.view(saved) };
    });
  }

  async render(userId: number, id: string) {
    await this.gate(userId);
    const p = await this.own(userId, id);
    if (this.renders.get(id)?.status === 'running')
      return { project: this.view(p) };

    const assets = this.assetsOf(p);
    const tracks = p.tracks as unknown as Track[];
    const outDirRel = path.join(this.dirOf(userId, id), 'renders');
    const renderId = this.media.newId();
    const outRel = path.join(outDirRel, `${renderId}.mp4`);
    const srtRel = path.join(outDirRel, `${renderId}.srt`);
    // Throws the 400 for an empty timeline before anything is started.
    const { args, total, srt } = renderArgs(
      assets,
      tracks,
      (a) => this.media.resolve(a.file ?? ''),
      this.media.resolve(outRel),
      {
        file: this.media.resolve(srtRel),
        burn: await this.media.hasFilter('subtitles'),
      },
    );

    const state: RenderState = {
      status: 'running',
      progress: 0,
      url: null,
      error: null,
      updatedAt: new Date().toISOString(),
    };
    this.renders.set(id, state);
    await this.prisma.editorProject.update({
      where: { id },
      data: { render: state as unknown as Prisma.InputJsonValue },
    });

    void (async () => {
      try {
        await this.media.ensureDir(outDirRel);
        if (srt) await this.media.write(srtRel, srt);
        await this.media.ffmpeg(args, 'render the timeline', (line) => {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (m) {
            state.progress = Math.min(0.99, Number(m[1]) / 1e6 / total);
            state.updatedAt = new Date().toISOString();
          }
        });
        // Keep the newest export only; older ones are dead weight on disk.
        const previous = (p.render as Partial<RenderState>)?.url;
        if (previous) {
          const prevRel = previous.replace(/^\/v1\/media\//, '');
          if (prevRel !== outRel)
            await this.media.remove(prevRel).catch(() => undefined);
        }
        if (srt) await this.media.remove(srtRel).catch(() => undefined);
        Object.assign(state, {
          status: 'done',
          progress: 1,
          url: this.media.urlFor(outRel),
        });
      } catch (error) {
        Object.assign(state, {
          status: 'failed',
          error:
            error instanceof Error
              ? `${error.message}. Check that every clip's file still plays, then export again.`
              : 'The export failed.',
        });
      }
      state.updatedAt = new Date().toISOString();
      await this.prisma.editorProject
        .update({
          where: { id },
          data: { render: state as unknown as Prisma.InputJsonValue },
        })
        .catch(() => undefined); // deleted mid-render
      this.renders.delete(id);
    })();

    return { project: this.view(p) };
  }
}
