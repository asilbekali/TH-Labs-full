import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** A transcript line, in the dubbing pipeline's own shape. */
export interface PipelineSegment {
  id: number;
  start: number;
  end: number;
  source_text: string;
  target_text: string | null;
  [key: string]: unknown;
}

export interface PipelineStage {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  message: string;
  detail: Record<string, unknown>;
}

/** The subset of a pipeline job (backend/app/schemas.py `Job`) read here. */
export interface PipelineJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  filename: string | null;
  simulated: boolean;
  error: string | null;
  options: {
    source_lang: string;
    target_lang: string;
    lip_sync: boolean;
    keep_background: boolean;
    quality: string;
    subtitles?: boolean;
  };
  stages: PipelineStage[];
  result: {
    output_url: string | null;
    source_url: string | null;
    duration: number | null;
    segments: PipelineSegment[];
    detected_source_lang: string | null;
    metrics?: { speaker_similarity?: number | null };
  };
  billing?: { trimmed?: boolean; notice?: string | null };
}

interface SpeechTask {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  audio_url: string | null;
  duration: number | null;
  error: string | null;
  engine: string | null;
}

const POLL_MS = 1200;
const SPEECH_TIMEOUT_MS = 5 * 60_000;

/**
 * Client for the dubbing pipeline (backend/, the AI service).
 *
 * The Studio Max tools need two things the AI owns — the jobs it ran, and
 * speech — and both are asked for through the pipeline's EXISTING public
 * endpoints, with the user's own token:
 *
 *   GET  /api/jobs/{id}   the dub: transcript, timings, output video
 *   POST /api/tts         speak a line (billed by the pipeline, per second)
 *   GET  /api/tts/{id}    poll it
 *   GET  /media/...       the files it produced
 *
 * Nothing here needs the pipeline changed, and the pipeline keeps scoping
 * every job to its owner.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private readonly base: string | null;

  constructor(config: ConfigService) {
    this.base =
      config.get<string>('DUB_API_URL')?.trim().replace(/\/+$/, '') || null;
  }

  private url(path: string): string {
    if (!this.base) {
      throw new ServiceUnavailableException(
        'The dubbing service is not connected to this server (DUB_API_URL).',
      );
    }
    return `${this.base}${path}`;
  }

  /** Absolute URL of a pipeline media path such as /media/outputs/x.mp4. */
  mediaUrl(path: string): string {
    return /^https?:\/\//.test(path) ? path : this.url(path);
  }

  private async call<T>(
    token: string,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.warn(
        `pipeline ${path} unreachable: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException(
        'The dubbing service is not reachable right now. Try again in a minute.',
      );
    }
    if (res.ok) return (await res.json()) as T;

    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      detail = '';
    }
    if (res.status === 401) {
      throw new UnauthorizedException(detail || 'Sign in to continue');
    }
    if (res.status === 404) {
      throw new NotFoundException(
        detail === 'Job not found'
          ? 'That dub is no longer on the dubbing server. Dub it again to edit it.'
          : detail || 'Not found',
      );
    }
    if (res.status === 402 || res.status === 400 || res.status === 503) {
      throw new HttpException(
        detail || 'The dubbing service refused that.',
        res.status,
      );
    }
    this.logger.error(`pipeline ${path} answered ${res.status}: ${detail}`);
    throw new BadGatewayException('The dubbing service failed. Try again.');
  }

  async getJob(token: string, jobId: string): Promise<PipelineJob> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
      throw new NotFoundException('Job not found');
    }
    const { job } = await this.call<{ job: PipelineJob }>(
      token,
      `/api/jobs/${encodeURIComponent(jobId)}`,
    );
    return job;
  }

  /**
   * Every word heard in an audio file, with its time (POST /api/transcribe).
   * Send small audio, not a whole video: the caller extracts it first.
   */
  async transcribe(
    token: string,
    file: string,
    language = 'auto',
  ): Promise<{
    language: string;
    words: { word: string; start: number; end: number }[];
  }> {
    const { readFile } = await import('node:fs/promises');
    const form = new FormData();
    form.append('file', new Blob([await readFile(file)]), 'audio.wav');
    form.append('language', language);
    let res: Response;
    try {
      res = await fetch(this.url('/api/transcribe'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch (error) {
      this.logger.warn(
        `pipeline /api/transcribe unreachable: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException(
        'The dubbing service is not reachable right now. Try again in a minute.',
      );
    }
    if (res.ok) {
      return (await res.json()) as {
        language: string;
        words: { word: string; start: number; end: number }[];
      };
    }
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      detail = '';
    }
    if (res.status === 401)
      throw new UnauthorizedException(detail || 'Sign in to continue');
    if (res.status === 400 || res.status === 503) {
      throw new HttpException(
        detail || 'Could not transcribe that.',
        res.status,
      );
    }
    this.logger.error(
      `pipeline /api/transcribe answered ${res.status}: ${detail}`,
    );
    throw new BadGatewayException('Speech recognition failed. Try again.');
  }

  async getSpeech(token: string, taskId: string): Promise<SpeechTask> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(taskId)) {
      throw new NotFoundException('Not found');
    }
    const { task } = await this.call<{ task: SpeechTask }>(
      token,
      `/api/tts/${encodeURIComponent(taskId)}`,
    );
    return task;
  }

  /**
   * Speak `text` in `language` and wait for it. Returns the pipeline media
   * path of the audio. Charged by the pipeline like any text to speech.
   */
  async speak(
    token: string,
    text: string,
    language: string,
  ): Promise<{ audioPath: string; duration: number; engine: string | null }> {
    const { task } = await this.call<{ task: SpeechTask }>(token, '/api/tts', {
      method: 'POST',
      body: { text, language },
    });
    const deadline = Date.now() + SPEECH_TIMEOUT_MS;
    let current = task;
    while (current.status === 'queued' || current.status === 'running') {
      if (Date.now() > deadline) {
        throw new HttpException(
          'The voice engine took too long. Try again.',
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      current = await this.getSpeech(token, task.id);
    }
    if (current.status !== 'done' || !current.audio_url) {
      throw new BadGatewayException(
        current.error ?? 'The voice engine could not speak that line.',
      );
    }
    return {
      audioPath: current.audio_url,
      duration: current.duration ?? 0,
      engine: current.engine,
    };
  }
}
