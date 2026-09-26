// Types mirroring the FastAPI backend schemas, plus the two responses the
// account API now serves in its place (Health and Language — see api.ts).

export interface Language {
  code: string
  name: string
  native: string
  flag: string
  whisper: string
  nllb: string
}

export interface StageInfo {
  key: string
  label: string
  engine: string
  mode: 'real' | 'simulation'
  detail: string
}

export interface Health {
  app: string
  version: string
  /** The pipeline's mode, or 'degraded' when the API could not reach it. */
  mode: string
  ffmpeg: boolean
  /**
   * Live stage/engine status. EMPTY MEANS UNKNOWN, not "no stages" — the
   * account API returns [] when the pipeline did not answer. Check `pipeline`
   * (via pipelineDown) before reading this as a pipeline that has nothing
   * loaded.
   */
  stages: StageInfo[]
  /**
   * Added by the account API's GET /v1/health. Optional because a build
   * pointed straight at the FastAPI pipeline gets its narrower payload, which
   * has neither field.
   */
  database?: 'up' | 'down'
  pipeline?: 'up' | 'down' | 'not_configured'
}

export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export interface StageState {
  key: string
  label: string
  status: StageStatus
  progress: number
  message: string
  duration_ms: number | null
  detail: Record<string, unknown>
}

export interface Segment {
  id: number
  start: number
  end: number
  source_text: string
  target_text: string | null
  speaker_similarity: number | null
}

export interface DubMetrics {
  wer: number | null
  bleu: number | null
  comet: number | null
  mos: number | null
  speaker_similarity: number | null
  sync_offset_ms: number | null
  processing_seconds: number | null
  real_time_factor: number | null
}

export interface JobResult {
  output_url: string | null
  source_url: string | null
  duration: number | null
  segments: Segment[]
  metrics: DubMetrics
  detected_source_lang: string | null
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface DubOptions {
  source_lang: string
  target_lang: string
  voice_clone: boolean
  lip_sync: boolean
  keep_background: boolean
  quality: string
  preserve_timing: boolean
}

export interface Job {
  id: string
  status: JobStatus
  options: DubOptions
  filename: string | null
  simulated: boolean
  stages: StageState[]
  result: JobResult
  error: string | null
  created_at: number
  updated_at: number
}

export interface JobEvent {
  final: boolean
  job: Job
}
