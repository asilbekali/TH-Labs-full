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
  emotion?: string | null
}

/**
 * Something in a finished dub worth the user's attention, with the fix to
 * offer. Built by backend/app/pipeline/issues.py. `segment_ids` names the lines
 * it is about, when it is about lines.
 */
export interface Issue {
  code: string
  severity: 'error' | 'warning' | 'info'
  title: string
  detail: string
  fix: string
  action: 'edit_line' | 'retry' | 'upgrade' | 'buy_tokens' | 'reupload' | 'none'
  segment_ids: number[]
}

/** A speech edit in progress — re-dubbing only the changed lines (Studio Max). */
export interface EditState {
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed'
  message: string
  /** 0 is the dub as first rendered; each successful edit bumps it. */
  version: number
  segment_ids: number[]
  error: string | null
  updated_at: number | null
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
  /** Set only when subtitles were asked for (absent on older backends). */
  subtitles_url?: string | null
  subtitles_vtt_url?: string | null
  /** True when the subtitles are in the picture; false → show the .vtt track. */
  subtitles_burned?: boolean
  /** What to look at in this dub and how to fix it (absent on older backends). */
  issues?: Issue[]
  /** The dubbed voice alone, without the background. */
  voice_url?: string | null
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
  subtitles?: boolean
}

/**
 * What this dub cost, straight from the server. `trimmed` is the field that
 * matters to the UI: when a balance covers only part of a video the pipeline
 * dubs the part it covers, and the user has to be told that what they are
 * watching is not the whole thing.
 *
 * Optional throughout — a job from a backend deployed before per-second pricing
 * carries none of it, and an unbilled deployment carries an empty object.
 */
export interface JobBilling {
  billed_seconds: number | null
  source_seconds: number | null
  credits_charged: number | null
  balance_after: number | null
  trimmed: boolean
  /** A sentence written for the user; set only when the dub was cut short. */
  notice: string | null
}

export interface Job {
  id: string
  status: JobStatus
  options: DubOptions
  filename: string | null
  simulated: boolean
  stages: StageState[]
  result: JobResult
  billing?: JobBilling
  /** Speech edits (Studio Max). Absent on older backends. */
  edit?: EditState
  error: string | null
  created_at: number
  updated_at: number
}

/** One row of GET /api/jobs — enough to list a dub, not to open it. */
export interface JobSummary {
  id: string
  status: JobStatus
  filename: string | null
  created_at: number
  updated_at: number
  target_lang: string
  source_lang: string
  duration: number | null
  segments: number
  output_url: string | null
  /** Errors + warnings (info items are not counted). */
  issues: number
  edit_version: number
  /** False for a dub made before edits were possible; it cannot be patched. */
  editable: boolean
}

export interface JobEvent {
  final: boolean
  job: Job
}
