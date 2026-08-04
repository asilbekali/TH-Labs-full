// Thin API client. Uses relative URLs so the Vite proxy (dev) and a reverse
// proxy (prod) both resolve to the FastAPI backend.
import type { Health, Job, JobEvent, Language, StageInfo } from "./types";
import { TEMPLATES, RESUMABLE } from "../mocks/templates";
import type { Template, ResumableJob } from "../mocks/templates";
import { WORKS } from "../mocks/works";
import type { WorkItem } from "../mocks/works";
import { TIERS, PACKS } from "../mocks/plans";
import type { Tier, Pack } from "../mocks/plans";

const BASE = "/api";

// UI-content endpoints (templates, resumable jobs) resolve from local mocks by
// default so the launchpad works with no backend. Set VITE_USE_MOCKS=false to
// hit the real API instead. The dubbing pipeline (createJob/getHealth/…) is
// never mocked — it always talks to the live backend.
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== "false";

// Randomized latency so loading skeletons are actually visible in dev.
const mockDelay = () =>
  new Promise((r) => setTimeout(r, 300 + Math.random() * 600));

// ── Offline fallbacks ───────────────────────────────────────────────────────
// When the backend is down (e.g. dev without the FastAPI server), callers can
// fall back to these so the language dropdown still renders and the health chip
// reads "Simulation mode" instead of going blank. Not a substitute for the
// live data — just a graceful degrade.
export const FALLBACK_LANGUAGES: Language[] = [
  {
    code: "en",
    name: "English",
    native: "English",
    flag: "🇬🇧",
    whisper: "en",
    nllb: "eng_Latn",
  },
  {
    code: "es",
    name: "Spanish",
    native: "Español",
    flag: "🇪🇸",
    whisper: "es",
    nllb: "spa_Latn",
  },
  {
    code: "fr",
    name: "French",
    native: "Français",
    flag: "🇫🇷",
    whisper: "fr",
    nllb: "fra_Latn",
  },
  {
    code: "de",
    name: "German",
    native: "Deutsch",
    flag: "🇩🇪",
    whisper: "de",
    nllb: "deu_Latn",
  },
  {
    code: "ru",
    name: "Russian",
    native: "Русский",
    flag: "🇷🇺",
    whisper: "ru",
    nllb: "rus_Cyrl",
  },
  {
    code: "uz",
    name: "Uzbek",
    native: "Oʻzbek",
    flag: "🇺🇿",
    whisper: "uz",
    nllb: "uzn_Latn",
  },
  {
    code: "it",
    name: "Italian",
    native: "Italiano",
    flag: "🇮🇹",
    whisper: "it",
    nllb: "ita_Latn",
  },
  {
    code: "pt",
    name: "Portuguese",
    native: "Português",
    flag: "🇵🇹",
    whisper: "pt",
    nllb: "por_Latn",
  },
  {
    code: "tr",
    name: "Turkish",
    native: "Türkçe",
    flag: "🇹🇷",
    whisper: "tr",
    nllb: "tur_Latn",
  },
  {
    code: "ar",
    name: "Arabic",
    native: "العربية",
    flag: "🇸🇦",
    whisper: "ar",
    nllb: "arb_Arab",
  },
  {
    code: "hi",
    name: "Hindi",
    native: "हिन्दी",
    flag: "🇮🇳",
    whisper: "hi",
    nllb: "hin_Deva",
  },
  {
    code: "zh",
    name: "Chinese",
    native: "中文",
    flag: "🇨🇳",
    whisper: "zh",
    nllb: "zho_Hans",
  },
  {
    code: "ja",
    name: "Japanese",
    native: "日本語",
    flag: "🇯🇵",
    whisper: "ja",
    nllb: "jpn_Jpan",
  },
  {
    code: "ko",
    name: "Korean",
    native: "한국어",
    flag: "🇰🇷",
    whisper: "ko",
    nllb: "kor_Hang",
  },
];

const SIM_STAGE = (key: string, label: string, engine: string): StageInfo => ({
  key,
  label,
  engine,
  mode: "simulation",
  detail: "backend offline — simulated",
});

export const FALLBACK_HEALTH: Health = {
  app: "TH-Labs",
  version: "offline",
  mode: "simulation",
  ffmpeg: false,
  stages: [
    SIM_STAGE("asr", "Transcription", "Whisper"),
    SIM_STAGE("separation", "Separation", "Demucs"),
    SIM_STAGE("nmt", "Translation", "NLLB"),
    SIM_STAGE("tts", "Voice cloning", "OmniVoice"),
    SIM_STAGE("sync", "Sync", "ffmpeg"),
  ],
};

export async function getHealth(): Promise<Health> {
  const r = await fetch(`${BASE}/health`);
  if (!r.ok) throw new Error("health failed");
  return r.json();
}

export async function getLanguages(): Promise<Language[]> {
  const r = await fetch(`${BASE}/languages`);
  if (!r.ok) throw new Error("languages failed");
  return (await r.json()).languages;
}

// ── Home launchpad content (mockable) ───────────────────────────────────────
// Template gallery. Mock: resolves to the bundled TEMPLATES after a short
// delay. Real: GET /api/templates → { templates: Template[] }.
export async function getTemplates(): Promise<Template[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return TEMPLATES;
  }
  const r = await fetch(`${BASE}/templates`);
  if (!r.ok) throw new Error("templates failed");
  return (await r.json()).templates;
}

// In-progress dubs for the "Continue where you left off" row. Mock: resolves to
// the bundled RESUMABLE list. Real: GET /api/jobs/active → { jobs: ResumableJob[] }.
export async function getResumable(): Promise<ResumableJob[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return RESUMABLE;
  }
  const r = await fetch(`${BASE}/jobs/active`);
  if (!r.ok) throw new Error("resumable failed");
  return (await r.json()).jobs;
}

// The user's dubbing library for the "My works" page (03). Mock: resolves to
// the bundled WORKS after a short delay. Real: GET /api/works → { works: WorkItem[] }.
export async function getWorks(): Promise<WorkItem[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return WORKS;
  }
  const r = await fetch(`${BASE}/works`);
  if (!r.ok) throw new Error("works failed");
  return (await r.json()).works;
}

// Subscription tiers + credit packs for the Plans page (04). Mock: resolves to
// the bundled catalog. Real: GET /api/plans → { tiers, packs }. Pricing is
// display data only — top-ups go through the wallet, not this endpoint.
export async function getPlans(): Promise<{ tiers: Tier[]; packs: Pack[] }> {
  if (USE_MOCKS) {
    await mockDelay();
    return { tiers: TIERS, packs: PACKS };
  }
  const r = await fetch(`${BASE}/plans`);
  if (!r.ok) throw new Error("plans failed");
  return r.json();
}

export interface CreateJobInput {
  target_lang: string;
  source_lang?: string;
  voice_clone?: boolean;
  lip_sync?: boolean;
  keep_background?: boolean;
  quality?: string;
  sample?: boolean;
  file?: File | null;
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const fd = new FormData();
  fd.append("target_lang", input.target_lang);
  fd.append("source_lang", input.source_lang ?? "auto");
  fd.append("voice_clone", String(input.voice_clone ?? true));
  fd.append("lip_sync", String(input.lip_sync ?? false));
  fd.append("keep_background", String(input.keep_background ?? true));
  fd.append("quality", input.quality ?? "balanced");
  fd.append("sample", String(input.sample ?? false));
  if (input.file) fd.append("file", input.file);

  const r = await fetch(`${BASE}/jobs`, { method: "POST", body: fd });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`job creation failed: ${r.status} ${msg}`);
  }
  return (await r.json()).job;
}

export async function getJob(jobId: string): Promise<Job> {
  const r = await fetch(`${BASE}/jobs/${jobId}`);
  if (!r.ok) throw new Error("job fetch failed");
  return (await r.json()).job;
}

// Poll job status on an interval until it finishes. Returns a stop() fn.
export function pollJob(
  jobId: string,
  onUpdate: (job: Job) => void,
  intervalMs = 3000,
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const job = await getJob(jobId);
      onUpdate(job);
      if (job.status === "completed" || job.status === "failed") return;
    } catch {
      /* keep polling */
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
  };
}

// Subscribe to live pipeline progress via Server-Sent Events.
export function subscribeJob(
  jobId: string,
  onEvent: (evt: JobEvent) => void,
  onError?: () => void,
): () => void {
  const es = new EventSource(`${BASE}/jobs/${jobId}/events`);
  es.onmessage = (e) => {
    try {
      const evt: JobEvent = JSON.parse(e.data);
      onEvent(evt);
      if (evt.final) es.close();
    } catch {
      /* ignore malformed frames */
    }
  };
  es.onerror = () => {
    es.close();
    onError?.();
  };
  return () => es.close();
}

// media URLs coming back from the API are already same-origin-relative.
export function mediaUrl(path: string | null): string | undefined {
  return path ?? undefined;
}
