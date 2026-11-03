import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Where media this API writes is served from (see main.ts). */
export const MEDIA_ROUTE = '/v1/media';

export interface ProbeResult {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Channels of the first audio stream; 0 when there is none. */
  audioChannels: number;
  width: number | null;
  height: number | null;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Files this API owns — speech-editor versions, video-editor uploads and
 * exports — and the ffmpeg work done on them.
 *
 * Everything lives under API_DATA_DIR (default ./data), which production
 * mounts as a volume. Files are served read-only at /v1/media under random
 * ids, the same model the dubbing pipeline uses for its own /media: a URL is
 * as private as the id in it, and a <video> tag can load it without a header.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  readonly root: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(
      config.get<string>('API_DATA_DIR')?.trim() ||
        path.join(process.cwd(), 'data'),
    );
  }

  /** An unguessable id for a file or folder name. */
  newId(): string {
    return randomBytes(9).toString('hex');
  }

  /** Absolute path for a path relative to the data dir; refuses escapes. */
  resolve(rel: string): string {
    const full = path.resolve(this.root, rel);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`path escapes the data directory: ${rel}`);
    }
    return full;
  }

  /** The public URL path for a file under the data dir. */
  urlFor(rel: string): string {
    return `${MEDIA_ROUTE}/${rel.split(path.sep).join('/')}`;
  }

  async ensureDir(rel: string): Promise<string> {
    const dir = this.resolve(rel);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async write(rel: string, content: string): Promise<void> {
    await writeFile(this.resolve(rel), content, 'utf8');
  }

  async remove(rel: string): Promise<void> {
    await rm(this.resolve(rel), { recursive: true, force: true });
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await stat(this.resolve(rel));
      return true;
    } catch {
      return false;
    }
  }

  /** Download `url` to `dest` (absolute). Throws on any non-2xx. */
  async download(
    url: string,
    dest: string,
    headers: Record<string, string> = {},
    timeoutMs = 10 * 60_000,
  ): Promise<void> {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok || !res.body) {
      throw new Error(`download ${url} answered ${res.status}`);
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      createWriteStream(dest),
    );
  }

  /** Run a binary to completion. `onStdoutLine` sees each stdout line. */
  run(
    bin: string,
    args: string[],
    opts: { timeoutMs?: number; onStdoutLine?: (line: string) => void } = {},
  ): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let buffered = '';
      const timer = setTimeout(
        () => child.kill('SIGKILL'),
        opts.timeoutMs ?? 30 * 60_000,
      );
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text.length < 1_000_000 ? text : '';
        if (opts.onStdoutLine) {
          buffered += text;
          const lines = buffered.split('\n');
          buffered = lines.pop() ?? '';
          lines.forEach(opts.onStdoutLine);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-20_000);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? new ServiceUnavailableException(
                `${bin} is not installed on this server.`,
              )
            : err,
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  }

  private filters: Promise<string> | null = null;

  /**
   * Whether this ffmpeg build has filter `name`. Asked once per process:
   * `subtitles` (burning text into the picture) needs libass, which the
   * Debian build in the Docker image has and some local builds do not.
   */
  async hasFilter(name: string): Promise<boolean> {
    this.filters ??= this.run('ffmpeg', ['-hide_banner', '-filters'], {
      timeoutMs: 30_000,
    })
      .then((r) => r.stdout)
      .catch(() => '');
    return new RegExp(`\\s${name}\\s`).test(await this.filters);
  }

  /** ffmpeg, failing loudly with the tail of its log. */
  async ffmpeg(
    args: string[],
    what: string,
    onStdoutLine?: (l: string) => void,
  ) {
    const r = await this.run('ffmpeg', ['-hide_banner', '-y', ...args], {
      onStdoutLine,
    });
    if (r.code !== 0) {
      this.logger.error(`ffmpeg ${what} failed: ${r.stderr.slice(-1500)}`);
      throw new Error(`ffmpeg could not ${what}`);
    }
  }

  async probe(file: string): Promise<ProbeResult> {
    const r = await this.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,width,height,channels',
        '-of',
        'json',
        file,
      ],
      { timeoutMs: 60_000 },
    );
    let info: {
      format?: { duration?: string };
      streams?: {
        codec_type?: string;
        width?: number;
        height?: number;
        channels?: number;
      }[];
    } = {};
    try {
      info = JSON.parse(r.stdout || '{}') as typeof info;
    } catch {
      info = {};
    }
    const streams = info.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video' && s.width);
    return {
      duration: Number(info.format?.duration) || 0,
      hasVideo: !!video,
      hasAudio: streams.some((s) => s.codec_type === 'audio'),
      audioChannels:
        streams.find((s) => s.codec_type === 'audio')?.channels ?? 0,
      width: video?.width ?? null,
      height: video?.height ?? null,
    };
  }

  /**
   * A coarse loudness envelope — `perSecond` points a second, capped — for a
   * timeline to draw. [] when it cannot be computed; a missing waveform is
   * cosmetic.
   */
  async peaks(
    file: string,
    duration: number,
    perSecond = 20,
  ): Promise<number[]> {
    if (duration <= 0) return [];
    const rate = 4000;
    const r = await new Promise<Buffer | null>((resolve) => {
      const child = spawn(
        'ffmpeg',
        [
          '-v',
          'error',
          '-i',
          file,
          '-vn',
          '-ac',
          '1',
          '-ar',
          String(rate),
          '-f',
          's16le',
          '-',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const chunks: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.on('error', () => resolve(null));
      child.on('close', () => resolve(Buffer.concat(chunks)));
    });
    if (!r || r.length < 2) return [];
    const samples = new Int16Array(
      r.buffer,
      r.byteOffset,
      Math.floor(r.length / 2),
    );
    const n = Math.min(Math.max(Math.round(duration * perSecond), 1), 6000);
    const size = Math.max(1, Math.floor(samples.length / n));
    const out: number[] = [];
    let top = 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (
        let j = i * size;
        j < Math.min((i + 1) * size, samples.length);
        j++
      ) {
        const v = Math.abs(samples[j]);
        if (v > m) m = v;
      }
      out.push(m);
      if (m > top) top = m;
    }
    return out.map((v) => Math.round((v / (top || 1)) * 1000) / 1000);
  }
}
