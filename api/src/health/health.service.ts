import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { API_NAME, API_VERSION } from '../version';
import { HealthResponseDto, StageInfoDto } from './dto/health-response.dto';

// The pipeline is a separate process on a GPU box that is routinely asleep or
// redeploying. A health check that waits on it is worse than useless — it turns
// "the pipeline is down" into "the account API is down too".
const PROBE_TIMEOUT_MS = 2500;

// Every open Studio tab polls this once a minute. Without a shared cache a busy
// afternoon means one outbound probe per tab per minute, all of them asking the
// same question. 10s is short enough that a pipeline coming back up shows in
// the UI on the next poll.
const CACHE_TTL_MS = 10_000;

/** The pipeline's health payload — the fields we pass through. */
interface PipelineHealth {
  mode?: unknown;
  ffmpeg?: unknown;
  stages?: unknown;
}

function isStageInfo(value: unknown): value is StageInfoDto {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.key === 'string' &&
    typeof s.label === 'string' &&
    typeof s.engine === 'string' &&
    (s.mode === 'real' || s.mode === 'simulation')
  );
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private cached: { at: number; value: HealthResponseDto } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponseDto> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) {
      return this.cached.value;
    }

    // Both checks are independent, and the pipeline probe is the slow one —
    // running them in sequence would add the database round-trip to every
    // response for nothing.
    const [database, pipeline] = await Promise.all([
      this.checkDatabase(),
      this.probePipeline(),
    ]);

    const value: HealthResponseDto = {
      app: API_NAME,
      version: API_VERSION,
      // These three describe the PIPELINE, not this API. When it does not
      // answer we report the absence rather than substituting a plausible
      // default: an empty `stages` renders as "unknown" in the Studio, while a
      // fabricated one would render as a working pipeline that cannot dub.
      mode: pipeline.health ? String(pipeline.health.mode ?? 'unknown') : 'degraded',
      ffmpeg: pipeline.health ? pipeline.health.ffmpeg === true : false,
      stages: pipeline.health ? this.readStages(pipeline.health.stages) : [],
      database,
      pipeline: pipeline.status,
    };

    this.cached = { at: now, value };
    return value;
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'down';
    }
  }

  /**
   * Ask the dubbing pipeline for its stage status.
   *
   * DUB_API_URL is the pipeline's origin (e.g. http://10.0.0.4:8000); its health
   * route is /api/health. Unset is a legitimate deployment — an account API with
   * no pipeline attached — and reports `not_configured`, which the UI shows
   * differently from a pipeline that is down.
   */
  private async probePipeline(): Promise<{
    status: 'up' | 'down' | 'not_configured';
    health: PipelineHealth | null;
  }> {
    const base = process.env.DUB_API_URL?.trim().replace(/\/+$/, '');
    if (!base) return { status: 'not_configured', health: null };

    try {
      const res = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Pipeline health probe returned ${res.status}`);
        return { status: 'down', health: null };
      }
      return { status: 'up', health: (await res.json()) as PipelineHealth };
    } catch (error) {
      // Expected whenever the GPU box is asleep. warn, not error — this is not
      // an account API fault and must not page anyone.
      this.logger.warn(
        `Pipeline unreachable at ${base}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: 'down', health: null };
    }
  }

  // The pipeline is a separate codebase on its own release cycle; a stage shape
  // it changes must not turn this endpoint into a 500. Anything unrecognised is
  // dropped rather than passed through half-typed.
  private readStages(raw: unknown): StageInfoDto[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isStageInfo).map((s) => ({
      key: s.key,
      label: s.label,
      engine: s.engine,
      mode: s.mode,
      detail: typeof s.detail === 'string' ? s.detail : '',
    }));
  }
}
