// The Studio (02).
//
// Layout is a workbench, not a form: on the left a deck of four steps where
// only the one you are working on is open and every other step still shows the
// value it holds, on the right a monitor that draws the dub as a chain of
// stages — the same chain before the run (the route your options have chosen)
// and during it (the route filling in). Between them, a run bar that always
// states the price before you commit to it.
//
// The pipeline logic below — the credit gate, job creation, SSE/polling, the
// mirror into the works library — is unchanged from the previous design. Only
// the presentation is new: "Deep Violet", the loud end of the palette (see the
// Studio block in index.css). The right column is a bento grid — three stat
// tiles over the monitor, the estimate and the tips — and the run card is the
// single saturated surface: deep violet, a mesh of light turning behind it,
// pale type in both themes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Uploader from "../components/Uploader";
import LanguageSelect from "../components/LanguageSelect";
import OptionToggle from "../components/OptionToggle";
import StageTimeline from "../components/StageTimeline";
import VideoCompare from "../components/VideoCompare";
import SegmentTable from "../components/SegmentTable";
import ResultMetrics from "../components/ResultMetrics";
import AnimatedNumber from "../components/AnimatedNumber";
import ScrollColumn from "../components/layout/ScrollColumn";
import Page from "../components/Page";
import LogoMark from "../components/brand/LogoMark";
import StepCard from "../components/studio/StepCard";
import StatTile from "../components/studio/StatTile";
import MagneticButton from "../components/MagneticButton";
import Equalizer from "../components/studio/Equalizer";
import ThinkingOrbs from "../components/ThinkingOrbs";
import PipelineFlow from "../components/studio/PipelineFlow";
import type { FlowNode } from "../components/studio/PipelineFlow";
import TourOverlay from "../components/onboarding/TourOverlay";
import type { TourStep } from "../components/onboarding/TourOverlay";
import { useIsDesktop } from "../hooks/useMediaQuery";
import { usePointerSpotlight } from "../hooks/usePointerSpotlight";
import {
  EASE_ENTRANCE,
  EASE_EXIT,
  rise,
  stagger,
  tapScale,
} from "../lib/motion";
import {
  createJob,
  mediaUrl,
  pipelineDown,
  pollJob,
  subscribeJob,
} from "../lib/api";
import type { Job } from "../lib/types";
import { useAuth } from "../lib/auth";
import {
  STUDIO_TOUR,
  accountKey,
  hasSeenTour,
  markTourSeen,
  shouldAutoStartTour,
} from "../lib/onboarding";
import { useWallet, QUALITY_COST } from "../lib/wallet";
import {
  useCanDub,
  useCommitDub,
  useHealth,
  useLanguages,
} from "../lib/queries";
import { useWorks, workTitle } from "../lib/works";
import { gradientFor } from "../lib/thumb";

const QUALITIES = [
  { key: "fast", label: "Fast" },
  { key: "balanced", label: "Balanced" },
  { key: "studio", label: "Studio" },
];

const SAMPLE_LANGS = ["uz", "ru", "es", "fr", "de"];

type StepId = "source" | "languages" | "options" | "quality";

// Best-effort source length for the credit gate. Sample clips are short (within
// the free-dub cap); for a real upload we read the media's metadata duration.
async function probeDurationSeconds(file: File | null): Promise<number> {
  if (!file) return 60;
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement("video");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(el.duration) ? Math.round(el.duration) : 0);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      el.src = url;
    } catch {
      resolve(0);
    }
  });
}

export default function Studio() {
  const { balance } = useWallet();
  const { works, addWork, updateWork } = useWorks();
  const { user, ready: authReady } = useAuth();

  // Cached by TanStack Query, so switching pages does not refetch the catalog
  // and the health chip stays live across the whole session.
  const { data: languages = [] } = useLanguages();
  const { data: health = null, isError: healthQueryFailed } = useHealth();
  // The health call itself now succeeds while the pipeline is asleep — the
  // account API answers for it — so "unreachable" is the response's `pipeline`
  // field, not just a failed query.
  const healthFailed = pipelineDown(health, healthQueryFailed);
  const canDubGate = useCanDub();
  const commit = useCommitDub();

  const [file, setFile] = useState<File | null>(null);
  // Upload-first: the sample clip is a real backend feature, but defaulting to
  // it made the Studio open in a demo-ish state.
  const [useSample, setUseSample] = useState(false);
  const [sourceLang, setSourceLang] = useState("auto");
  // Turkic-first product, so the default target is Uzbek rather than Spanish.
  const [targetLang, setTargetLang] = useState("uz");
  const [voiceClone, setVoiceClone] = useState(true);
  const [lipSync, setLipSync] = useState(false);
  const [keepBackground, setKeepBackground] = useState(true);
  const [quality, setQuality] = useState("balanced");

  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<null | (() => void)>(null);
  const savedRef = useRef<string | null>(null);

  useEffect(() => () => unsubRef.current?.(), []);

  useEffect(() => {
    if (file) setUseSample(false);
  }, [file]);

  // Preset handoff from the Home launchpad (01): a quick-start card or a
  // template passes router state; apply it through the EXISTING setters only —
  // no new pipeline state is introduced here.
  const location = useLocation();
  const presetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const s = location.state as {
      preset?: "video" | "podcast" | "voice";
      sourceLang?: string;
      targetLang?: string;
      voiceClone?: boolean;
      lipSync?: boolean;
      keepBackground?: boolean;
      quality?: string;
    } | null;
    if (!s || location.key === presetKeyRef.current) return;
    presetKeyRef.current = location.key;
    // A quick-start card only picks a quality — it never swaps the user's
    // upload out for the sample clip.
    if (s.preset === "video") {
      setQuality("balanced");
    } else if (s.preset === "podcast" || s.preset === "voice") {
      setQuality("studio");
    }
    if (s.sourceLang) setSourceLang(s.sourceLang);
    if (s.targetLang) setTargetLang(s.targetLang);
    // "Duplicate these settings" from My works (03) hands the full config over
    // through router state; apply it via the EXISTING setters only.
    if (typeof s.voiceClone === "boolean") setVoiceClone(s.voiceClone);
    if (typeof s.lipSync === "boolean") setLipSync(s.lipSync);
    if (typeof s.keepBackground === "boolean")
      setKeepBackground(s.keepBackground);
    if (s.quality) setQuality(s.quality);
  }, [location.key, location.state]);

  const running = job?.status === "running" || job?.status === "queued";
  const completed = job?.status === "completed";
  const failed = job?.status === "failed";

  const overall = useMemo(() => {
    if (!job) return 0;
    const active = job.stages.filter((s) => s.status !== "skipped");
    if (!active.length) return 0;
    return Math.round(
      (active.reduce((a, s) => a + s.progress, 0) / active.length) * 100,
    );
  }, [job]);

  // The stage the pipeline is on right now — what the orbs are thinking about.
  const activeStage = useMemo(
    () => job?.stages.find((s) => s.status === "running")?.label ?? null,
    [job],
  );

  const stageProgress = useMemo(() => {
    if (!job) return { done: 0, total: 0 };
    const active = job.stages.filter((s) => s.status !== "skipped");
    return {
      done: active.filter((s) => s.status === "done").length,
      total: active.length,
    };
  }, [job]);

  // Mirror the live job into the works library. The record is created the
  // moment the job is (see start()), so a run that is still processing shows up
  // in My Works and on the dashboard; this keeps it in step as the pipeline
  // reports progress, and writes the real result — media URLs, transcript
  // segments, measured duration — when it lands.
  useEffect(() => {
    if (!job || savedRef.current !== job.id) return;
    const runningStage = job.stages.find((s) => s.status === "running");
    updateWork(job.id, {
      status:
        job.status === "completed"
          ? "completed"
          : job.status === "failed"
            ? "failed"
            : "processing",
      stage: runningStage?.label ?? null,
      progress: overall / 100,
      simulated: job.simulated,
      sourceLang: job.result.detected_source_lang ?? sourceLang,
      outputUrl: job.result.output_url,
      sourceUrl: job.result.source_url,
      durationSec: job.result.duration,
      segments: job.result.segments,
      error: job.error,
      speakerSimilarity:
        job.result.metrics.speaker_similarity != null
          ? job.result.metrics.speaker_similarity / 100
          : null,
    });
  }, [job, overall, updateWork, sourceLang]);

  const isSampleRun = useSample && !file;
  const sampleLangNote = isSampleRun && !SAMPLE_LANGS.includes(targetLang);
  const cost = QUALITY_COST[quality] ?? 10;
  const sourceReady = !!(file || isSampleRun);
  const canStart = sourceReady && !!targetLang;

  const lastWork = works[0];

  async function start() {
    setError(null);
    // Server-authoritative gate: the free dub, an active subscription, or enough
    // credits. Read-only — it charges nothing.
    const durationSeconds = await probeDurationSeconds(
      isSampleRun ? null : file,
    );
    try {
      const gate = await canDubGate.mutateAsync({ durationSeconds, quality });
      if (!gate.allowed) {
        setError(
          gate.reason === "FREE_DUB_LENGTH_EXCEEDED"
            ? `Your free dub covers clips up to 2 minutes — this one is longer. See Plans to continue.`
            : `Not enough credits — this ${quality} dub costs ${gate.cost}, you have ${gate.balance}. Top up in Plans.`,
        );
        return;
      }
    } catch (e) {
      setError(
        e instanceof Error && /unauthor|401|session/i.test(e.message)
          ? "Please sign in to start a dub."
          : e instanceof Error
            ? e.message
            : "Could not verify your credits.",
      );
      return;
    }
    setBusy(true);
    setJob(null);
    savedRef.current = null;
    unsubRef.current?.();
    try {
      const created = await createJob({
        target_lang: targetLang,
        source_lang: sourceLang,
        voice_clone: voiceClone,
        lip_sync: lipSync,
        keep_background: keepBackground,
        quality,
        sample: isSampleRun,
        file: isSampleRun ? null : file,
      });
      setJob(created);
      savedRef.current = created.id;
      // Record the run immediately, so it is in the library (as "Running") even
      // if the user navigates away or the tab is closed mid-pipeline. The effect
      // above fills in the result as the job progresses.
      addWork({
        id: created.id,
        createdAt: Date.now(),
        status: "processing",
        filename: created.filename,
        sourceLang: created.result.detected_source_lang ?? sourceLang,
        targetLang,
        durationSec: created.result.duration,
        outputUrl: null,
        sourceUrl: created.result.source_url,
        simulated: created.simulated,
        speakerSimilarity: null,
        creditsSpent: null,
        settings: { voiceClone, lipSync, keepBackground, quality },
        segments: [],
        error: null,
        progress: 0,
        stage: null,
      });
      // The job exists — now actually charge it (or consume the free dub).
      // Idempotent on jobId; never blocks the pipeline UI, but the charge it
      // reports back is what the library records as the real cost.
      commit
        .mutateAsync({ jobId: created.id, durationSeconds, quality })
        .then((res) =>
          // A free dub costs nothing even though the API still reports the
          // tariff it would otherwise have charged.
          updateWork(created.id, { creditsSpent: res.charged ? res.cost : 0 }),
        )
        .catch(() => {
          /* the pipeline keeps running; cost stays unknown rather than guessed */
        });
      const stopSse = subscribeJob(
        created.id,
        (evt) => setJob(evt.job),
        () => {
          const stopPoll = pollJob(created.id, (j) => setJob(j));
          unsubRef.current = stopPoll;
        },
      );
      unsubRef.current = stopSse;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start job");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    unsubRef.current?.();
    setJob(null);
    setError(null);
  }

  function swapLangs() {
    if (sourceLang === "auto") return;
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  }

  // ── Presentation-only state (no pipeline logic) ──────────────────────────
  const isDesktop = useIsDesktop();
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);

  // Reset both columns to the top when a run begins or the status changes.
  useEffect(() => {
    rightScrollRef.current?.scrollTo({ top: 0 });
    leftScrollRef.current?.scrollTo({ top: 0 });
  }, [job?.status]);

  // Elapsed clock while a run is live.
  const [elapsed, setElapsed] = useState(0);
  const runStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      runStartRef.current = null;
      return;
    }
    if (runStartRef.current == null) runStartRef.current = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Date.now() - (runStartRef.current ?? Date.now()));
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);

  // Auto-advancing tips carousel.
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setTip((t) => (t + 1) % TIPS.length),
      6000,
    );
    return () => window.clearInterval(id);
  }, []);

  const after = balance - cost;
  const short = balance < cost;
  const barPct =
    balance > 0 ? Math.min(100, Math.round((cost / balance) * 100)) : 100;

  // ── The step deck ────────────────────────────────────────────────────────
  // One step open at a time, and a record of which steps the user has actually
  // set themselves — steps 02–04 ship with working defaults, so a tick there
  // has to mean "you chose this", not "this has a value".
  const [openStep, setOpenStep] = useState<StepId | null>("source");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = useCallback(
    (id: StepId) => setTouched((t) => (t[id] ? t : { ...t, [id]: true })),
    [],
  );
  const toggleStep = useCallback(
    (id: StepId) => setOpenStep((prev) => (prev === id ? null : id)),
    [],
  );

  // Hand the user to the next decision the moment they have a source, once per
  // upload — never yanking them somewhere else if they opened a step on purpose.
  const advancedRef = useRef(false);
  useEffect(() => {
    if (!sourceReady) {
      advancedRef.current = false;
      return;
    }
    if (advancedRef.current) return;
    advancedRef.current = true;
    setOpenStep((prev) => (prev === "source" ? "languages" : prev));
  }, [sourceReady]);

  const langName = useCallback(
    (code: string) =>
      code === "auto"
        ? "Auto-detect"
        : (languages.find((l) => l.code === code)?.name ?? code.toUpperCase()),
    [languages],
  );
  const langFlag = useCallback(
    (code: string) =>
      code === "auto"
        ? "🌐"
        : (languages.find((l) => l.code === code)?.flag ?? "🏳️"),
    [languages],
  );

  const optionSummary = [
    voiceClone ? "Voice clone" : "Generic voice",
    keepBackground ? "Keep background" : "Speech only",
    lipSync ? "Lip sync" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const sourceSummary = file
    ? `${file.name} · ${(file.size / 1_048_576).toFixed(1)} MB`
    : isSampleRun
      ? "Built-in sample clip"
      : "Nothing chosen yet";

  // ── Onboarding walkthrough ───────────────────────────────────────────────
  const key = accountKey(user?.id);
  const [tourOpen, setTourOpen] = useState(false);
  // Returning users get a quieter Guide button; first-timers who skipped keep
  // the same entry point, just without the automatic open.
  const [tourSeen, setTourSeen] = useState(() => hasSeenTour(STUDIO_TOUR, key));

  const closeTour = useCallback(() => {
    setTourOpen(false);
    // Finishing and skipping mean the same thing here: do not open by itself
    // again. Nobody wants to be taught the same page twice.
    markTourSeen(STUDIO_TOUR, key);
    setTourSeen(true);
  }, [key]);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!authReady || autoStartedRef.current || job) return;
    if (!shouldAutoStartTour(STUDIO_TOUR, key, user?.createdAt)) return;
    autoStartedRef.current = true;
    // Let the page's entrance animation land first, so the spotlight measures
    // elements that have stopped moving.
    const t = window.setTimeout(() => setTourOpen(true), 650);
    return () => window.clearTimeout(t);
  }, [authReady, key, user?.createdAt, job]);

  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        id: "welcome",
        title: "Welcome to the Studio",
        body: "This is where a clip becomes a dub: four short decisions on the left, the run on the right. Ninety seconds and you will know the whole thing.",
        note: "← → to move · Esc to leave",
      },
      {
        id: "source",
        target: "tour-source",
        prefer: "right",
        onEnter: () => setOpenStep("source"),
        title: "01 · Bring in a clip",
        body: "Drop a video or audio file here, or click to browse — MP4, MOV, WAV and MP3 all work. Nothing to hand? Switch on the built-in sample clip and every other control behaves exactly the same.",
      },
      {
        id: "languages",
        target: "tour-languages",
        prefer: "right",
        onEnter: () => setOpenStep("languages"),
        title: "02 · Choose the languages",
        body: "Leave the source on Auto-detect if you are not sure — the transcriber works it out. Set the target to what you want to hear; the round button between them swaps the pair.",
      },
      {
        id: "options",
        target: "tour-options",
        prefer: "right",
        onEnter: () => setOpenStep("options"),
        title: "03 · Voice and mix",
        body: "Keep the original speaker's voice instead of a narrator, keep the music and ambience behind the speech, and turn on lip sync when the speaker is on camera.",
      },
      {
        id: "quality",
        target: "tour-quality",
        prefer: "right",
        onEnter: () => setOpenStep("quality"),
        title: "04 · Quality, and what it costs",
        body: "Fast skips the heavy stages, Studio runs all of them. This is the one setting that moves the price — the credit figure updates as you switch.",
      },
      {
        id: "monitor",
        target: "tour-monitor",
        prefer: "left",
        title: "Watch the route",
        body: "This panel draws your dub as a chain of stages. Right now it shows the route your options have chosen — greyed-out links are the stages you switched off. During a run each link fills in live, and the finished video, its transcript and the download land here too.",
      },
      {
        id: "cost",
        target: "tour-cost",
        prefer: "left",
        title: "Know the price first",
        body: "What this run costs and what your balance looks like afterwards, before you commit. If you are short, the link to top up is right there.",
      },
      {
        id: "run",
        target: "tour-run",
        prefer: "top",
        title: "Start the dub",
        body: "The button stays disabled until there is a clip to work on. Underneath it, a live line tells you whether the dubbing pipeline is actually up — worth a glance before a long run.",
      },
      {
        id: "done",
        title: "That is the whole loop",
        body: "Every finished dub is saved to My works, so you can come back to it, download it again, or reuse its settings. Open this walkthrough whenever you like from the Guide button.",
      },
    ],
    [],
  );

  // ── Preview / live flow nodes ────────────────────────────────────────────
  const previewNodes: FlowNode[] = useMemo(
    () => [
      { key: "asr", label: "Transcribe", sub: "Whisper", state: "idle" },
      {
        key: "nmt",
        label: "Translate",
        sub: targetLang.toUpperCase(),
        state: "idle",
      },
      {
        key: "tts",
        label: "Clone voice",
        sub: voiceClone ? "same speaker" : "off",
        state: voiceClone ? "idle" : "skipped",
      },
      {
        key: "lipsync",
        label: "Sync lips",
        sub: lipSync ? "on camera" : "off",
        state: lipSync ? "idle" : "skipped",
      },
      {
        key: "separation",
        label: "Mix",
        sub: keepBackground ? "keep music" : "speech only",
        state: keepBackground ? "idle" : "skipped",
      },
    ],
    [targetLang, voiceClone, lipSync, keepBackground],
  );

  const liveNodes: FlowNode[] = useMemo(
    () =>
      (job?.stages ?? []).map((s) => ({
        key: s.key,
        label: s.label,
        state: s.status === "pending" ? "idle" : s.status,
      })),
    [job],
  );

  const stepsDone = [
    sourceReady,
    !!touched.languages,
    !!touched.options,
    !!touched.quality,
  ].filter(Boolean).length;

  // ═══════════════════════════════════════════════════════════════════════
  // Presentation — "Fired Glaze"
  //
  // The screen is a bento: a 380px setup rail on the left (deck header, the
  // four steps, and the one saturated surface on the page carrying the run
  // button), and on the right a grid of tiles that starts with three
  // at-a-glance stats and opens into the monitor.
  //
  // Nothing below reaches into the pipeline. Every value it draws — cost,
  // balance, health, stages, elapsed — was computed above and is untouched.
  // ═══════════════════════════════════════════════════════════════════════

  // ── Left column: header, step deck, run bar ──────────────────────────────
  const deckHeader = (
    <div className="flex items-end justify-between gap-3 px-1">
      <div className="min-w-0">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-brand">
          / 02 — Studio
        </span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-[13px] font-medium text-primary">
            Set up your dub
          </span>
          <span className="font-mono text-[11px] text-muted">
            <AnimatedNumber value={stepsDone} duration={350} />
            /4
          </span>
        </div>
        {/* The progress rail. Each segment fills with the signature ramp when
            its step is answered — a spring, so a step that flips back to
            unanswered visibly drains rather than blinking off. */}
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="relative h-1 w-8 overflow-hidden rounded-full bg-sunken"
            >
              <motion.span
                className="absolute inset-0 rounded-full fill-signature"
                initial={false}
                animate={{ scaleX: i < stepsDone ? 1 : 0 }}
                style={{ originX: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            </span>
          ))}
        </div>
      </div>
      <motion.button
        type="button"
        onClick={() => setTourOpen(true)}
        title="Show the walkthrough"
        whileHover={{ y: -2 }}
        whileTap={tapScale}
        transition={{ type: "spring", stiffness: 400, damping: 26 }}
        className={`focusable inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 font-mono text-[11px] transition-colors ${
          tourSeen
            ? "border-subtle text-muted hover:border-brand/40 hover:text-brand"
            : "border-brand/40 bg-brand/[0.08] text-brand"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.2-1.3 2.1v.2M12 17.5h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
        Guide
      </motion.button>
    </div>
  );

  const stepDeck = (
    <>
      <StepCard
        n="01"
        title="Source"
        summary={sourceSummary}
        done={sourceReady}
        open={openStep === "source"}
        onToggle={() => toggleStep("source")}
        tour="tour-source"
      >
        <Uploader file={file} onFile={setFile} disabled={running} />
        <button
          type="button"
          role="switch"
          aria-checked={isSampleRun}
          disabled={running}
          onClick={() => {
            const next = !isSampleRun;
            setUseSample(next);
            if (next) setFile(null);
          }}
          className="focusable group flex w-full items-center justify-between gap-2.5 rounded-control border border-subtle bg-sunken px-3.5 py-3 text-left text-sm text-secondary transition-colors hover:border-brand/35 disabled:opacity-60"
        >
          <span>Use the built-in sample clip</span>
          <SwitchTrack on={isSampleRun} />
        </button>
      </StepCard>

      <StepCard
        n="02"
        title="Languages"
        summary={
          <span className="flex items-center gap-1.5">
            <span aria-hidden>{langFlag(sourceLang)}</span>
            {langName(sourceLang)}
            <span className="text-brand">→</span>
            <span aria-hidden>{langFlag(targetLang)}</span>
            {langName(targetLang)}
          </span>
        }
        done={!!touched.languages}
        open={openStep === "languages"}
        onToggle={() => toggleStep("languages")}
        tour="tour-languages"
      >
        <div className="relative space-y-3">
          <LanguageSelect
            label="Source language"
            languages={languages}
            value={sourceLang}
            onChange={(v) => {
              setSourceLang(v);
              markTouched("languages");
            }}
            allowAuto
          />
          {/* The swap control sits on the hairline between the two selects, so
              the pair reads as one instrument rather than two fields. */}
          <div className="relative flex justify-center">
            <span
              aria-hidden
              className="absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-subtle"
            />
            <motion.button
              type="button"
              onClick={() => {
                swapLangs();
                markTouched("languages");
              }}
              disabled={sourceLang === "auto"}
              whileHover={{ scale: 1.08 }}
              whileTap={{ rotate: 180, scale: 0.94 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              aria-label="Swap source and target languages"
              className="focusable relative -my-1 grid h-9 w-9 place-items-center rounded-full border border-subtle bg-surface text-secondary shadow-sm transition-colors hover:border-brand/50 hover:text-brand disabled:opacity-40"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />
              </svg>
            </motion.button>
          </div>
          <LanguageSelect
            label="Target language"
            languages={languages}
            value={targetLang}
            onChange={(v) => {
              setTargetLang(v);
              markTouched("languages");
            }}
          />
        </div>
        {sampleLangNote && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE_ENTRANCE }}
            className="flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn/[0.07] px-3 py-2.5 text-xs text-warn"
          >
            <span className="icon-tile mt-px h-6 w-6 shrink-0 bg-warn/15 text-warn">
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </span>
            <span className="flex-1 leading-relaxed">
              The sample ships hand-authored translations for UZ, RU, ES, FR,
              DE. Pick one of those to hear a real translation, or upload your
              own clip for full NLLB translation.
            </span>
          </motion.div>
        )}
      </StepCard>

      <StepCard
        n="03"
        title="Voice & mix"
        summary={optionSummary}
        done={!!touched.options}
        open={openStep === "options"}
        onToggle={() => toggleStep("options")}
        tour="tour-options"
      >
        <OptionToggle
          checked={voiceClone}
          onChange={(v) => {
            setVoiceClone(v);
            markTouched("options");
          }}
          title="Voice cloning"
          description="Preserve the original speaker's voice instead of a generic narrator."
          icon={<path d="M3 12h3l2-6 3 15 3-12 2 5h4" />}
        />
        <OptionToggle
          checked={keepBackground}
          onChange={(v) => {
            setKeepBackground(v);
            markTouched("options");
          }}
          title="Keep background & effects"
          description="Dub over the original music/ambience instead of replacing it; the original speech is removed (Demucs)."
          icon={
            <path d="M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          }
        />
        <OptionToggle
          checked={lipSync}
          onChange={(v) => {
            setLipSync(v);
            markTouched("options");
          }}
          accent="magenta"
          title="Lip sync (optional)"
          description="Reshape the speaker's mouth to match the translated speech (Wav2Lip)."
          icon={<path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />}
        />
      </StepCard>

      <StepCard
        n="04"
        title="Quality"
        summary={`${QUALITIES.find((q) => q.key === quality)?.label ?? quality} · ${cost} credits`}
        done={!!touched.quality}
        open={openStep === "quality"}
        onToggle={() => toggleStep("quality")}
        tour="tour-quality"
      >
        <div className="flex rounded-control border border-subtle bg-sunken p-1">
          {QUALITIES.map((q) => (
            <button
              key={q.key}
              onClick={() => {
                setQuality(q.key);
                markTouched("quality");
              }}
              disabled={running}
              className="focusable relative flex-1 rounded-[10px] px-3 py-2 font-mono text-xs font-medium transition-colors"
            >
              {/* One pill that slides between the three options — the same
                  element, so the movement is a layout animation rather than a
                  fade between two pills. */}
              {quality === q.key && (
                <motion.span
                  layoutId="quality-pill"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-[10px] bg-brand/15 shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.45)]"
                />
              )}
              <span
                className={`relative z-10 ${quality === q.key ? "text-brand" : "text-muted hover:text-primary"}`}
              >
                {q.label}
              </span>
            </button>
          ))}
        </div>
        {/* The blurb swaps with the setting, so the sentence tracks the pill
            instead of sitting there as static help text. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={quality}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2 }}
            className="text-[11px] leading-relaxed text-muted"
          >
            {quality === "fast" &&
              "Fastest — skips separation & voice cloning. Best for long videos."}
            {quality === "balanced" &&
              "Balanced — separation + voice cloning on."}
            {quality === "studio" &&
              "Highest fidelity — full pipeline. Best quality, slowest."}
          </motion.p>
        </AnimatePresence>
      </StepCard>
    </>
  );

  // ── The run card ─────────────────────────────────────────────────────────
  // The one saturated surface on the screen: deep glaze, a mesh of light
  // turning slowly behind it, film grain over the top so the gradient never
  // bands. Everything here is porcelain type on a fired ground — which is why
  // the card looks the same in both themes instead of inverting.
  const ctaBlock = (
    <div data-tour="tour-run" className="deep-card aurora grain space-y-3 p-4">
      {running && <span className="beam" aria-hidden />}

      <div className="above flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] on-deep-dim">
          This run
        </span>
        <span className="flex items-center gap-2 font-mono text-[11px] on-deep-dim">
          {running ? (
            <ThinkingOrbs size={20} speed={7} />
          ) : (
            <Equalizer idle className="text-white/70" />
          )}
          <span>
            <span
              className={
                short
                  ? "font-medium text-[rgb(var(--mesh-c))]"
                  : "font-medium text-white"
              }
            >
              {cost}
            </span>{" "}
            / {balance.toLocaleString()} cr
          </span>
        </span>
      </div>

      <MagneticButton
        onClick={start}
        disabled={busy || running || !canStart}
        title={
          !canStart ? "Choose a source and a target language first" : undefined
        }
        className="btn-on-deep focusable above w-full py-3.5 font-mono text-sm"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={busy ? "busy" : running ? "run" : canStart ? "go" : "idle"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="flex items-center justify-center gap-2"
          >
            {(busy || running) && <ThinkingOrbs size={18} speed={6.5} />}
            {busy
              ? "Starting…"
              : running
                ? `Dubbing… ${overall}%`
                : canStart
                  ? `Start dubbing · ${cost} →`
                  : "Add a clip to start"}
          </motion.span>
        </AnimatePresence>
      </MagneticButton>

      {/* A rail under the button while the pipeline is live, so the run card
          itself reports progress without the eye going anywhere. */}
      <AnimatePresence initial={false}>
        {running && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="above overflow-hidden"
          >
            <div className="h-1 overflow-hidden rounded-full bg-white/15">
              <motion.div
                className="h-full rounded-full bg-white/85"
                initial={false}
                animate={{ width: `${overall}%` }}
                transition={{ duration: 0.5, ease: EASE_ENTRANCE }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Three honest states: unreachable, running simulated stages, or live.
          An unreachable API used to fall back to a fabricated "simulation"
          status, which looked identical to a real simulated pipeline. */}
      {(health || healthFailed) && (
        <p className="above flex items-center justify-center gap-1.5 text-center font-mono text-[11px] on-deep-dim">
          <span className="relative flex h-1.5 w-1.5">
            {!healthFailed && (
              <motion.span
                aria-hidden
                className={`absolute inset-0 rounded-full ${
                  health!.stages.some((s) => s.mode === "real")
                    ? "bg-success"
                    : "bg-warn"
                }`}
                animate={{ scale: [1, 2.6, 1], opacity: [0.6, 0, 0.6] }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
              />
            )}
            <span
              className={`relative h-1.5 w-1.5 rounded-full ${
                healthFailed
                  ? "bg-danger"
                  : health!.stages.some((s) => s.mode === "real")
                    ? "bg-success"
                    : "bg-warn"
              }`}
            />
          </span>
          {healthFailed
            ? "Dubbing service unreachable"
            : health!.stages.some((s) => s.mode === "real")
              ? "Pipeline online"
              : "Simulation mode — no models loaded"}
        </p>
      )}
    </div>
  );

  // ── The stat row ─────────────────────────────────────────────────────────
  // Three small tiles across the top of the bento. They answer the questions
  // you would otherwise scroll to find: what can I spend, what is the pipeline
  // doing, and what did I last make.
  const statRow = (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="bento bento-3"
    >
      <StatTile
        label="Credits"
        tint="brand"
        value={<AnimatedNumber value={balance} />}
        foot={short ? "short for this run" : `${after.toLocaleString()} after`}
        icon={
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" />
          </svg>
        }
      />
      <StatTile
        label="Pipeline"
        tint={
          failed ? "warn" : running ? "brand" : completed ? "success" : "magenta"
        }
        value={
          running
            ? `${stageProgress.done}/${stageProgress.total} stages`
            : completed
              ? "Complete"
              : failed
                ? "Failed"
                : "Idle"
        }
        foot={
          running
            ? `${overall}% · ${fmtElapsed(elapsed)}`
            : `${quality} · ${cost} cr`
        }
        icon={<Equalizer idle={!running} className="h-3.5 text-current" />}
      />
      <StatTile
        label="Last dub"
        tint="gold"
        value={
          lastWork
            ? `${lastWork.sourceLang.toUpperCase()} → ${lastWork.targetLang.toUpperCase()}`
            : "None yet"
        }
        foot={lastWork ? workTitle(lastWork) : "your first run lands here"}
        icon={
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7.5 12 3l9 4.5-9 4.5z" />
            <path d="M3 12l9 4.5L21 12M3 16.5 12 21l9-4.5" />
          </svg>
        }
      />
    </motion.div>
  );

  // ── Right column content (idle monitor vs. live run) ─────────────────────
  const rightContent = (
    <>
      {statRow}

      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.25, ease: EASE_ENTRANCE }}
            className="overflow-hidden"
          >
            <div className="card border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger">
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!job ? (
          <motion.div
            key="idle"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98, filter: "blur(4px)" }}
            transition={{ duration: 0.28, ease: EASE_EXIT }}
            className="bento"
          >
            {/* The monitor: the route this dub will take, drawn from the
                options as they stand. */}
            <MonitorCard tour="tour-monitor">
              <div className="above">
                <div className="flex items-center justify-between gap-3">
                  <SectionMark>Route</SectionMark>
                  <span className="font-mono text-[11px] text-muted">
                    {sourceReady ? "Ready when you are" : "Waiting for a clip"}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <LangBadge
                    key={sourceLang}
                    flag={langFlag(sourceLang)}
                    label={langName(sourceLang)}
                  />
                  <motion.svg
                    animate={{ x: [0, 5, 0], opacity: [0.55, 1, 0.55] }}
                    transition={{
                      duration: 2.4,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                    viewBox="0 0 24 24"
                    className="h-5 w-5 text-brand"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </motion.svg>
                  <LangBadge
                    key={targetLang}
                    flag={langFlag(targetLang)}
                    label={langName(targetLang)}
                    accent
                  />
                  <span className="ml-auto truncate font-mono text-[11px] text-muted">
                    {sourceSummary}
                  </span>
                </div>

                <div className="mt-6">
                  <PipelineFlow nodes={previewNodes} />
                </div>

                <div className="rule-signature mt-5" />
                <p className="mt-4 text-center text-[13px] text-secondary">
                  {sourceReady
                    ? "Start the run and these stages fill in live — the finished video, its transcript and the download all land here."
                    : "Add a clip on the left, or load the sample, and this route becomes a dub."}
                </p>
                {!sourceReady && (
                  <div className="mt-3 text-center">
                    <motion.button
                      onClick={() => {
                        setUseSample(true);
                        setFile(null);
                      }}
                      whileHover={{ y: -2 }}
                      whileTap={tapScale}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 26,
                      }}
                      className="btn-ghost focusable px-5 py-2.5 font-mono text-sm"
                    >
                      Load the sample clip →
                    </motion.button>
                  </div>
                )}
              </div>
            </MonitorCard>

            {/* Estimate + Tips side by side — the price of the decision you
                just made, next to the thing worth knowing while you make it. */}
            <div className="bento xl:grid-cols-[1.15fr_0.85fr]">
              <div data-tour="tour-cost" className="card sheen p-5">
                <SectionMark>Estimate</SectionMark>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="font-mono text-4xl font-medium text-primary">
                      <AnimatedNumber value={cost} />
                      <span className="ml-1.5 font-mono text-sm text-muted">
                        credits
                      </span>
                    </div>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={quality}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18 }}
                        className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.13em] text-muted"
                      >
                        {quality} run
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  {short && (
                    <Link
                      to="/plans"
                      className="font-mono text-xs text-danger underline-offset-2 hover:underline"
                    >
                      Top up in Plans →
                    </Link>
                  )}
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken">
                  <motion.div
                    className={`h-full rounded-full ${short ? "bg-danger" : "fill-signature"}`}
                    initial={false}
                    animate={{ width: `${barPct}%` }}
                    transition={{ type: "spring", stiffness: 220, damping: 30 }}
                  />
                </div>
                <div className="mt-2 flex justify-between font-mono text-[11px] text-muted">
                  <span>Balance {balance.toLocaleString()}</span>
                  <span className={short ? "text-danger" : ""}>
                    After {after.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Tips */}
              <div className="card sheen p-5">
                <SectionMark>Tips</SectionMark>
                <div className="mt-3 flex items-start gap-3">
                  <motion.span
                    className="icon-tile mt-0.5 h-8 w-8 shrink-0 bg-warn/15 text-warn"
                    animate={{ rotate: [0, -8, 8, 0] }}
                    transition={{
                      duration: 5,
                      repeat: Infinity,
                      ease: "easeInOut",
                      times: [0, 0.1, 0.2, 1],
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="currentColor"
                    >
                      <path d="m12 3 2.4 5.3 5.8.5-4.4 3.8 1.3 5.6L12 20.9 6.9 18.8l1.3-5.6L3.8 8.8l5.8-.5z" />
                    </svg>
                  </motion.span>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={tip}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3, ease: EASE_ENTRANCE }}
                      className="min-h-[2.5rem] flex-1 text-sm text-secondary"
                    >
                      {TIPS[tip]}
                    </motion.p>
                  </AnimatePresence>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex gap-1.5">
                    {TIPS.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setTip(i)}
                        aria-label={`Tip ${i + 1}`}
                        className={`h-1.5 rounded-full transition-all duration-300 ${i === tip ? "w-5 bg-brand" : "w-1.5 bg-strong hover:bg-brand/50"}`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTourOpen(true)}
                    className="focusable font-mono text-[11px] text-brand hover:underline"
                  >
                    Replay the guide →
                  </button>
                </div>
              </div>
            </div>

            {/* Recent dubs — full width under the pair, and only when there is
                something to show. */}
            {works.length > 0 && (
              <div className="card sheen p-5">
                <div className="flex items-center justify-between">
                  <SectionMark>Recent dubs</SectionMark>
                  <Link
                    to="/works"
                    className="font-mono text-[11px] text-brand hover:underline"
                  >
                    View all →
                  </Link>
                </div>
                <motion.div
                  variants={stagger}
                  initial="hidden"
                  animate="show"
                  className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
                >
                  {works.slice(0, 3).map((w) => (
                    <motion.div
                      key={w.id}
                      variants={rise}
                      whileHover={{ y: -2 }}
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 26,
                      }}
                      className="group flex items-center gap-3 rounded-control border border-subtle bg-sunken/60 p-2 transition-colors hover:border-brand/35"
                    >
                      <span
                        className="thumb-grad h-10 w-14 shrink-0 rounded-lg"
                        style={{ backgroundImage: gradientFor(w.id) }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-primary">
                          {workTitle(w)}
                        </div>
                        <div className="font-mono text-[11px] text-muted">
                          {w.sourceLang.toUpperCase()}→
                          {w.targetLang.toUpperCase()} · {fmtDur(w.durationSec)}
                        </div>
                      </div>
                      {w.outputUrl && (
                        <a
                          href={mediaUrl(w.outputUrl)}
                          download
                          aria-label="Download"
                          className="focusable grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted opacity-0 transition-opacity hover:bg-surface hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
                          </svg>
                        </a>
                      )}
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="live"
            initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.35, ease: EASE_ENTRANCE }}
            className="bento"
          >
            {/* The same monitor, now carrying the real run. While the pipeline
                is live the card wears a glaze halo and a travelling hairline —
                the two cues that say "this is working" without a spinner. */}
            <div
              data-tour="tour-monitor"
              className={`card relative overflow-hidden p-5 transition-shadow duration-500 ${
                running ? "running-halo" : ""
              }`}
            >
              {running && <span className="beam" aria-hidden />}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={job.status}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ duration: 0.2 }}
                        className="text-sm font-medium text-primary"
                      >
                        {running
                          ? "Running pipeline"
                          : completed
                            ? "Dub complete"
                            : failed
                              ? "Pipeline failed"
                              : "Queued"}
                      </motion.span>
                    </AnimatePresence>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${job.simulated ? "bg-warn/15 text-warn" : "bg-success/15 text-success"}`}
                    >
                      {job.simulated ? "simulation" : "live"}
                    </span>
                    {running && <Equalizer className="text-brand" />}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted">
                    job {job.id} · {job.filename ?? "sample"} · →
                    {targetLang.toUpperCase()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <RingProgress value={overall} live={running} />
                  {(completed || failed) && (
                    <motion.button
                      onClick={reset}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      whileHover={{ y: -2 }}
                      whileTap={tapScale}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 26,
                      }}
                      className="btn-ghost focusable px-4 py-2 font-mono text-sm"
                    >
                      New dub
                    </motion.button>
                  )}
                </div>
              </div>

              {/* The thinking orbs — the loading state proper. While a stage
                  is being worked on the cluster turns over a warm wash and
                  names the stage; the percentage next to it is the only claim
                  about rate, and it comes from the pipeline itself. */}
              <AnimatePresence initial={false}>
                {running && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: EASE_ENTRANCE }}
                    className="overflow-hidden"
                  >
                    <div className="mt-5 flex items-center gap-4 rounded-card border border-brand/20 bg-brand/[0.06] px-4 py-3.5">
                      <ThinkingOrbs
                        size={64}
                        speed={11}
                        label={
                          activeStage
                            ? `Working on ${activeStage}`
                            : "Pipeline working"
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={activeStage ?? "queued"}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.22 }}
                            className="truncate text-sm font-medium text-primary"
                          >
                            {activeStage ?? "Queued — waiting for a worker"}
                          </motion.div>
                        </AnimatePresence>
                        <div className="mt-1 font-mono text-[11px] text-muted">
                          {overall}% · stage{" "}
                          {Math.min(stageProgress.done + 1, stageProgress.total)}{" "}
                          of{" "}
                          {stageProgress.total} · {fmtElapsed(elapsed)}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-5">
                <PipelineFlow nodes={liveNodes} />
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-subtle pt-4 font-mono text-[11px] text-muted">
                <span>
                  {stageProgress.done}/{stageProgress.total} stages · {cost}{" "}
                  credits
                </span>
                <span>
                  <span className="text-primary">{fmtElapsed(elapsed)}</span>{" "}
                  elapsed
                </span>
              </div>
            </div>

            {completed && (
              <motion.div
                variants={stagger}
                initial="hidden"
                animate="show"
                className="bento"
              >
                <motion.div variants={rise}>
                  <VideoCompare
                    sourceUrl={job.result.source_url ?? undefined}
                    outputUrl={job.result.output_url ?? undefined}
                    simulated={job.simulated}
                  />
                </motion.div>
                {job.result.output_url && (
                  <motion.a
                    variants={rise}
                    href={job.result.output_url}
                    download
                    whileHover={{ y: -2 }}
                    whileTap={tapScale}
                    transition={{ type: "spring", stiffness: 400, damping: 26 }}
                    className="btn-primary focusable inline-flex w-fit px-5 py-2.5 font-mono text-sm"
                  >
                    ↓ Download dubbed video
                  </motion.a>
                )}
                <motion.div variants={rise}>
                  <ResultMetrics m={job.result.metrics} />
                </motion.div>
                <motion.div variants={rise}>
                  <SegmentTable segments={job.result.segments} />
                </motion.div>
              </motion.div>
            )}

            <div className="card p-5">
              <SectionMark>Pipeline stages</SectionMark>
              <div className="mt-3">
                <StageTimeline stages={job.stages} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  const tour = (
    <TourOverlay steps={tourSteps} open={tourOpen} onClose={closeTour} />
  );

  // ── Desktop: fixed two-column shell ──────────────────────────────────────
  if (isDesktop) {
    return (
      <Page className="h-full min-h-0">
        {/* The deck is a RANGE, not a fixed 380px: at 1024px a hard 380 leaves
            the monitor column too narrow to hold its bento row, and the shell
            starts scrolling sideways. It shrinks to 300 before the layout has
            to give anything else up. */}
        <div className="grid h-full min-h-0 grid-cols-[clamp(300px,26vw,380px)_minmax(0,1fr)] gap-4 xl:gap-6">
          <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
            {deckHeader}
            <ScrollColumn ref={leftScrollRef} className="space-y-2.5 pr-0.5">
              {stepDeck}
            </ScrollColumn>
            <div>{ctaBlock}</div>
          </aside>
          <ScrollColumn ref={rightScrollRef} className="min-w-0 space-y-4 pr-0.5">
            {rightContent}
          </ScrollColumn>
        </div>
        {tour}
      </Page>
    );
  }

  // ── Mobile: single scrolling stack ───────────────────────────────────────
  // The run card is the fixed bar above the tab bar instead of a card in the
  // flow, so the deep surface moves there and the deck keeps the full width.
  return (
    <Page>
      <div className="space-y-4 pb-36">
        {deckHeader}
        <div className="space-y-2.5">{stepDeck}</div>
        {rightContent}
        <div
          data-tour="tour-run"
          className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] z-30"
        >
          <div className="deep-card aurora grain flex items-center gap-3 px-3.5 py-2.5">
            {running && <span className="beam" aria-hidden />}
            <span className="above flex min-w-0 flex-col">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] on-deep-dim">
                {running ? `${overall}% · ${fmtElapsed(elapsed)}` : "This run"}
              </span>
              <span className="font-mono text-sm font-medium text-white">
                {cost} credits
              </span>
            </span>
            <MagneticButton
              onClick={start}
              disabled={busy || running || !canStart}
              strength={4}
              className="btn-on-deep focusable above ml-auto inline-flex shrink-0 items-center gap-2 px-5 py-2.5 font-mono text-sm"
            >
              {(busy || running) && <ThinkingOrbs size={16} speed={6.5} />}
              {busy
                ? "Starting…"
                : running
                  ? `Dubbing… ${overall}%`
                  : "Start dubbing →"}
            </MagneticButton>
          </div>
        </div>
      </div>
      {tour}
    </Page>
  );
}

// ── Tips ───────────────────────────────────────────────────────────────────
const TIPS = [
  "Keep clips under a couple of minutes for the fastest turnaround.",
  "Voice cloning needs clear, single-speaker audio to match the original best.",
  "Lip sync earns its cost on close-up talking-head footage, less so on voiceover.",
  "The built-in sample ships translations for UZ, RU, ES, FR and DE.",
];

// ── Small presentational helpers ───────────────────────────────────────────
function fmtDur(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * The idle monitor's shell: a card with the pointer-tracked glaze pool, a slow
 * sweep on hover, and the logo turning behind it at a speed you only notice if
 * you stare. Split out so the spotlight hook has its own element to write to.
 */
function MonitorCard({
  tour,
  children,
}: {
  tour?: string;
  children: ReactNode;
}) {
  const spot = usePointerSpotlight<HTMLDivElement>();
  return (
    <div
      ref={spot.ref}
      data-tour={tour}
      onPointerEnter={spot.onPointerEnter}
      onPointerMove={spot.onPointerMove}
      className="card spotlight sheen relative overflow-hidden p-6"
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -right-14"
        animate={{ rotate: 360 }}
        transition={{ duration: 160, repeat: Infinity, ease: "linear" }}
      >
        <LogoMark className="h-[200px] w-[200px] text-primary/[0.045]" />
      </motion.div>
      {children}
    </div>
  );
}

// The language pair on the monitor — flag, name, and the target in brand. The
// badge re-mounts on a language change (it is keyed by code), which is what
// gives the flag its little pop when you pick a different language.
function LangBadge({
  flag,
  label,
  accent,
}: {
  flag: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      className="inline-flex items-center gap-2"
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-control text-lg ${
          accent ? "bg-brand/12 ring-1 ring-brand/25" : "bg-sunken"
        }`}
        aria-hidden
      >
        {flag}
      </span>
      <span
        className={`font-mono text-sm font-medium ${accent ? "text-brand" : "text-primary"}`}
      >
        {label}
      </span>
    </motion.span>
  );
}

// The animated 44×24 switch track — animates transform, not left.
function SwitchTrack({ on, accent }: { on: boolean; accent?: "magenta" }) {
  return (
    <span
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ${
        on
          ? accent === "magenta"
            ? "bg-magenta"
            : "bg-brand"
          : "bg-sunken shadow-[inset_0_0_0_1px_rgb(var(--c-border-strong))]"
      }`}
    >
      <motion.span
        className="absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow"
        animate={{ x: on ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
      />
    </span>
  );
}

// Circular ring showing overall progress. While the run is live a second,
// fainter ring turns behind it, so a stage that takes a minute still looks
// like something is happening at 0% movement.
function RingProgress({ value, live }: { value: number; live?: boolean }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-12 w-12 place-items-center">
      {live && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand/45"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
        />
      )}
      <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="rgb(var(--c-border-subtle))"
          strokeWidth="3.5"
        />
        <motion.circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="rgb(var(--c-brand-500))"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 0.6, ease: EASE_ENTRANCE }}
        />
      </svg>
      <span className="absolute font-mono text-[11px] font-medium text-primary">
        <AnimatedNumber value={value} duration={500} />
      </span>
    </div>
  );
}

// `/ SECTION` marker.
function SectionMark({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-muted">
      / {children}
    </span>
  );
}
