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
import LinkInput, { readLink } from "../components/LinkInput";
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
import VoicePicker, {
  PlanLockBadge,
  voiceModeLabel,
  type VoiceMode,
} from "../components/studio/VoicePicker";
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
  PaymentRequiredError,
  createJob,
  mediaUrl,
  pipelineDown,
  pollJob,
  revoiceJob,
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
import {
  useWallet,
  CREDITS_PER_MINUTE_BY_QUALITY,
  affordableSeconds,
  estimateDubCost,
} from "../lib/wallet";
import {
  PLAN_TIER_NAMES,
  cheapestTierWith,
  languageAllowed,
  type PlanFeatures,
} from "../lib/payments-api";
import {
  useCanDub,
  useCommitDub,
  useEntitlements,
  useHealth,
  useLanguages,
  usePlans,
} from "../lib/queries";
import { useWorks, workTitle } from "../lib/works";
import WorkThumb from "../components/WorkThumb";

const QUALITIES = [
  { key: "fast", label: "Fast" },
  { key: "balanced", label: "Balanced" },
  { key: "studio", label: "Studio" },
];

const SAMPLE_LANGS = ["uz", "ru", "es", "fr", "de"];

type StepId = "source" | "languages" | "options" | "quality";

// Best-effort source length for the credit gate. Sample clips are short (within
// the free-dub cap); for a real upload we read the media's metadata duration.
/** The host of a URL, for a one-line summary. Never throws on odd input. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

/** `95.4` -> `1m 35s`. The same phrasing the server uses in its notices. */
export function formatSeconds(seconds: number | null | undefined): string {
  const total = Math.floor(Math.max(0, Number(seconds) || 0));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

// Best-effort source length, used for the estimate line and the preflight gate.
//
// NOT rounded any more. The cost is prorated per second, so the fraction is
// real information — and rounding here was half of why every dub 402'd: the
// browser sent a whole number that the API accepted while the server sent the
// true fractional length that it rejected. Both now send the real value.
async function probeDurationSeconds(file: File | null): Promise<number> {
  // 60 is the assumption for a link or the sample clip: the media sits on
  // someone else's server and the browser never sees it, so there is nothing to
  // measure. The server measures it for real and the charge follows that.
  if (!file) return 60;
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement("video");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(el.duration) ? el.duration : 0);
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
  const { balance, refresh: refreshWallet } = useWallet();
  const { works, addWork, updateWork } = useWorks();
  const { user, ready: authReady } = useAuth();

  // Cached by TanStack Query, so switching pages does not refetch the catalog
  // and the health chip stays live across the whole session.
  const { data: languages = [] } = useLanguages();
  const { data: health = null, isError: healthQueryFailed } = useHealth();
  // The live tariff (credits per minute, per quality). Public and cached, so the
  // estimate line quotes the server's prices rather than a bundled copy that
  // silently goes stale after a price change.
  const { data: plansCatalog } = usePlans();
  // The health call itself now succeeds while the pipeline is asleep — the
  // account API answers for it — so "unreachable" is the response's `pipeline`
  // field, not just a failed query.
  const healthFailed = pipelineDown(health, healthQueryFailed);
  const canDubGate = useCanDub();
  const commit = useCommitDub();

  const [file, setFile] = useState<File | null>(null);
  // Paste-a-link, the second way in. Kept as its own piece of state rather than
  // a variant of `file` because the two are genuinely different requests: an
  // upload streams bytes from the browser, a link is fetched by the server.
  const [sourceUrl, setSourceUrl] = useState("");
  // Which source the Start button will actually use. Three sources are possible
  // (upload, link, sample) and exactly one can win, so the choice is explicit
  // state rather than something inferred from which fields happen to be filled —
  // inferring it is how you get a request carrying both, which the API rejects.
  const [sourceMode, setSourceMode] = useState<"upload" | "link">("upload");
  // Upload-first: the sample clip is a real backend feature, but defaulting to
  // it made the Studio open in a demo-ish state.
  const [useSample, setUseSample] = useState(false);
  const [sourceLang, setSourceLang] = useState("auto");
  // Turkic-first product, so the default target is Uzbek rather than Spanish.
  const [targetLang, setTargetLang] = useState("uz");
  // Whose voice the dub speaks in, and in what accent. `voiceClone` is derived
  // from it rather than stored: the pipeline still takes a boolean, and keeping
  // two pieces of state that must agree is how they stop agreeing.
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("both");
  // Optional clip of a different voice to dub in. Only meaningful when the dub
  // is cloning something, so it is dropped when the mode goes to `native`.
  const [reference, setReference] = useState<File | null>(null);
  const voiceClone = voiceMode !== "native";
  // "Duplicate these settings" from My works replays a run that only ever
  // recorded a boolean, so a saved `true` lands on the default cloning mode
  // rather than guessing which of the two it was.
  const setVoiceClone = useCallback(
    (v: boolean) => setVoiceMode(v ? "both" : "native"),
    [],
  );
  const [lipSync, setLipSync] = useState(false);
  const [keepBackground, setKeepBackground] = useState(true);
  const [quality, setQuality] = useState("balanced");

  // What this account's plan unlocks (Free: no lip sync, no Studio quality, …).
  // The API enforces the same table on can-dub and commit-dub; this only keeps
  // the controls honest. Until it loads — or on an API that predates it —
  // nothing is locked here and the server decides.
  const { data: entitlements } = useEntitlements(!!user);
  const features = entitlements?.features;
  const tierNames = entitlements?.tierNames ?? PLAN_TIER_NAMES;
  // Name of the cheapest plan that unlocks something, for the lock badges.
  const unlockName = (ok: (f: PlanFeatures) => boolean) =>
    tierNames[cheapestTierWith(entitlements?.allTiers, ok)];
  const canLipSync = features?.lipSync ?? true;
  const canKeepBackground = features?.keepBackground ?? true;
  const canReference = features?.referenceVoice ?? true;
  const qualityAllowed = (q: string) => features?.qualities.includes(q) ?? true;
  const voiceModeAllowed = (m: string) =>
    features?.voiceModes.includes(m) ?? true;
  const langAllowed = (code: string) => languageAllowed(features, code);

  // Keep the state itself within the plan, so a value set before the plan was
  // known — a default, a "duplicate settings" replay, a swap — is never sent.
  useEffect(() => {
    if (!features) return;
    if (!features.qualities.includes(quality)) {
      setQuality(
        features.qualities.includes("balanced")
          ? "balanced"
          : (features.qualities[0] ?? "fast"),
      );
    }
    if (!languageAllowed(features, targetLang)) {
      const list = features.targetLanguages;
      const fallback =
        list === "all" || list.includes("uz") ? "uz" : (list[0] ?? "uz");
      setTargetLang(fallback);
    }
    if (!features.voiceModes.includes(voiceMode)) {
      setVoiceMode((features.voiceModes[0] ?? "both") as VoiceMode);
    }
    if (!features.lipSync && lipSync) setLipSync(false);
    if (!features.keepBackground && keepBackground) setKeepBackground(false);
    if (!features.referenceVoice && reference) setReference(null);
  }, [
    features,
    quality,
    targetLang,
    voiceMode,
    lipSync,
    keepBackground,
    reference,
  ]);

  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoicing, setRevoicing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when `error` is a credit refusal, so the box can offer the fix.
  const [needsCredits, setNeedsCredits] = useState(false);
  // Measured length of the chosen upload. Probed as soon as a file is picked
  // rather than at Start, because the price depends on it and a price that
  // appears only after you commit is not a price.
  const [sourceSeconds, setSourceSeconds] = useState<number | null>(null);
  const unsubRef = useRef<null | (() => void)>(null);
  const savedRef = useRef<string | null>(null);

  useEffect(() => () => unsubRef.current?.(), []);

  useEffect(() => {
    if (file) setUseSample(false);
  }, [file]);

  // Measure the upload as soon as it is chosen. `stale` guards the usual
  // async-in-effect hazard: pick a long file, then a short one before the first
  // probe resolves, and without it the long file's duration wins.
  useEffect(() => {
    if (!file) {
      setSourceSeconds(null);
      return;
    }
    let stale = false;
    void probeDurationSeconds(file).then((secs) => {
      if (!stale) setSourceSeconds(secs > 0 ? secs : null);
    });
    return () => {
      stale = true;
    };
  }, [file]);

  // One source at a time, enforced in one place. Switching the tab drops what
  // the other tab held, so there is never a stale file sitting behind a pasted
  // link waiting to be sent instead of it.
  useEffect(() => {
    if (sourceMode === "upload") setSourceUrl("");
    else setFile(null);
  }, [sourceMode]);

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
      /** A URL already typed into the dashboard composer. */
      link?: string;
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
    // A link pasted into the dashboard composer arrives already validated by
    // the same readLink() this page's field uses, so it only has to be moved
    // into state. Switching the tab is what makes it the source that wins —
    // see the one-source-at-a-time effect above.
    if (s.link) {
      setSourceMode("link");
      setSourceUrl(s.link);
      setUseSample(false);
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
      // Carried through so the library can explain a short output later. For a
      // link job this is the first the browser hears of it: the length was only
      // ever known server-side.
      trimmed: job.billing?.trimmed ?? false,
      sourceSec: job.billing?.source_seconds ?? null,
      // Spread, not `?? undefined`: updateWork merges the patch over the record,
      // so a literal `undefined` here would ERASE the cost — which is exactly
      // what the unbilled-backend path writes from its own commit-dub call.
      // Only send the field when the server actually reported a charge.
      ...(job.billing?.credits_charged != null
        ? { creditsSpent: job.billing.credits_charged }
        : {}),
      error: job.error,
      speakerSimilarity:
        job.result.metrics.speaker_similarity != null
          ? job.result.metrics.speaker_similarity / 100
          : null,
    });
  }, [job, overall, updateWork, sourceLang]);

  // The vetted URL, or null when the box is empty or holds something that is not
  // a usable link yet. Same verdict the field itself is displaying — derived
  // once here so the Start button and the hint can never disagree.
  const linkUrl = sourceMode === "link" ? readLink(sourceUrl).url : null;
  const isSampleRun = useSample && !file && !linkUrl;
  // A source is chosen, so a price is worth quoting even if its length is only
  // an assumption (link / sample).
  const sourceReadyForQuote = !!(file || linkUrl || isSampleRun);
  const sampleLangNote = isSampleRun && !SAMPLE_LANGS.includes(targetLang);
  // ── The price, and whether the wallet covers it ──────────────────────────
  // Per-second pricing means the estimate needs a length. For an upload that is
  // measured; for a link or the sample it is the same 60s assumption the
  // preflight uses, and the server settles the real number.
  //
  // `rates` prefers the server's published tariff over the bundled fallback, so
  // a price change on the API does not need a Studio redeploy to show up.
  const rates = plansCatalog?.qualityCost ?? CREDITS_PER_MINUTE_BY_QUALITY;
  const quotedSeconds = sourceSeconds ?? (sourceReadyForQuote ? 60 : 0);
  const cost = estimateDubCost(quotedSeconds, quality, rates);
  // How much of this clip the balance actually covers. Below the clip's length
  // means the dub will be cut short — the same arithmetic the server does, shown
  // before the user commits rather than reported after.
  const affordable = affordableSeconds(balance, quality, rates);
  const willTrim = quotedSeconds > 0 && affordable < quotedSeconds;
  const billableSeconds = Math.min(quotedSeconds, affordable);
  const billableCost = estimateDubCost(billableSeconds, quality, rates);
  // Nothing at all is affordable: the only way forward is to buy.
  const walletEmpty = affordable <= 0;

  const sourceReady = !!(file || linkUrl || isSampleRun);
  const canStart = sourceReady && !!targetLang && !walletEmpty;

  const lastWork = works[0];

  async function start() {
    // The options a plan can lock, as the gate checks them.
    const dubFeatures = {
      targetLang,
      voiceMode,
      voiceClone,
      referenceVoice: !!reference,
      keepBackground,
      lipSync: lipSyncAvailable && lipSync,
    };
    setError(null);
    setNeedsCredits(false);
    // Server-authoritative gate. Read-only — it charges nothing.
    //
    // A refusal here now means only one thing: the balance buys no dubbing at
    // all. A balance that covers PART of the clip is allowed through, and the
    // server trims the source to what was paid for — so the job still runs and
    // the user gets the first minute of their video rather than an error.
    //
    // A link has no duration to probe: the media is on someone else's server and
    // the browser never sees it, so this falls back to the same 60s default the
    // sample clip uses. The server fetches the file, learns the real duration,
    // and settles the charge against that — so a link's trim is decided there,
    // not here, and the notice comes back on the job.
    const durationSeconds = await probeDurationSeconds(
      isSampleRun ? null : file,
    );
    try {
      const gate = await canDubGate.mutateAsync({
        durationSeconds,
        quality,
        features: dubFeatures,
      });
      if (!gate.allowed) {
        setNeedsCredits(true);
        setError(
          `You have ${gate.balance} credits — not enough to dub any of this ` +
            `video. A minute costs ${gate.creditsPerMinute} at ${quality} quality.`,
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
        voice_mode: voiceMode,
        reference,
        lip_sync: lipSyncAvailable && lipSync,
        keep_background: keepBackground,
        quality,
        sample: isSampleRun,
        file: isSampleRun ? null : file,
        source_url: linkUrl,
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
        creditsSpent: created.billing?.credits_charged ?? null,
        trimmed: created.billing?.trimmed ?? false,
        sourceSec: created.billing?.source_seconds ?? null,
        settings: { voiceClone, lipSync, keepBackground, quality },
        segments: [],
        error: null,
        progress: 0,
        stage: null,
      });

      // Who charges for this dub.
      //
      // The dubbing backend charges server-side before it will queue a job, and
      // it knows the real length AND the trimmed length — so when it reports a
      // charge, that is the charge, and calling commit-dub from here would only
      // repeat it (harmlessly, being idempotent on jobId) with a duration that
      // is wrong for a trimmed run.
      //
      // The fallback matters for a backend with no account API configured — a
      // local run, or the docker-compose stack — where nothing has been charged
      // and the browser is the only thing that can do it.
      if (created.billing?.credits_charged != null) {
        // Already charged and already recorded above. Just refresh the wallet so
        // the top-bar balance catches up with a charge this tab did not make.
        void refreshWallet();
      } else {
        commit
          .mutateAsync({
            jobId: created.id,
            durationSeconds,
            quality,
            features: dubFeatures,
          })
          .then((res) =>
            updateWork(created.id, { creditsSpent: res.charged ? res.cost : 0 }),
          )
          .catch(() => {
            /* the pipeline keeps running; cost stays unknown rather than guessed */
          });
      }
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
      // The server does the credit check again — the browser's preflight is a
      // courtesy, not the authority — so a refusal can land here even though the
      // gate above said yes: a link's real length is only known server-side, and
      // the balance can move between the two calls. Offer the fix either way.
      if (e instanceof PaymentRequiredError) setNeedsCredits(true);
      setError(e instanceof Error ? e.message : "Failed to start job");
    } finally {
      setBusy(false);
    }
  }

  // Re-voice the current dub with the user's corrected translation. The backend
  // returns a NEW job built from the same source video, so this attaches to it
  // exactly as start() does — including recording it in the library, where it
  // appears as its own entry rather than overwriting the run it corrects.
  //
  // No commitDub call: a correction is not a second dub, so nothing is charged.
  async function revoice(edits: { id: number; target_text: string }[]) {
    if (!job || !edits.length) return;
    setRevoicing(true);
    setError(null);
    try {
      const created = await revoiceJob(job.id, edits);
      unsubRef.current?.();
      setJob(created);
      savedRef.current = created.id;
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
        creditsSpent: 0,
        settings: { voiceClone, lipSync, keepBackground, quality },
        segments: [],
        error: null,
        progress: 0,
        stage: null,
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
      setError(e instanceof Error ? e.message : "Failed to re-dub");
    } finally {
      setRevoicing(false);
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

  // Whether this deployment can actually lip-sync, straight from /health:
  // Wav2Lip is optional and usually absent, and a toggle that silently does
  // nothing is worse than one that says it cannot.
  const lipSyncAvailable =
    health?.stages.some((s) => s.key === "lipsync" && s.mode === "real") ??
    false;

  const optionSummary = [
    voiceModeLabel(voiceMode),
    reference ? "Custom voice" : null,
    keepBackground ? "Keep background" : "Speech only",
    lipSyncAvailable && lipSync ? "Lip sync" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const sourceSummary = file
    ? `${file.name} · ${(file.size / 1_048_576).toFixed(1)} MB`
    : linkUrl
      ? // The host, not the whole URL: a YouTube watch URL is 43 characters of
        // opaque id and would push everything else out of a one-line summary.
        `Link · ${safeHost(linkUrl)}`
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
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight text-primary">
            Set up your dub
          </span>
          <span className="text-[12px] text-muted">
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
        className={`focusable inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12px] transition-colors ${
          tourSeen
            ? "border-subtle text-secondary hover:border-strong hover:text-primary"
            : "border-strong bg-sunken text-primary"
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
        {/* Two ways in, as tabs rather than two always-visible fields: only one
            can be sent, and showing both filled-in invites the question of which
            one wins. */}
        <div
          role="tablist"
          aria-label="Where the video comes from"
          className="flex gap-1 rounded-control bg-sunken p-1"
        >
          {(
            [
              { id: "upload", label: "Upload a file" },
              { id: "link", label: "Paste a link" },
            ] as const
          ).map((tab) => {
            const active = sourceMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={running}
                onClick={() => setSourceMode(tab.id)}
                className={`focusable relative flex-1 rounded-[calc(var(--radius-control)-2px)] px-3 py-2 font-mono text-xs transition-colors disabled:opacity-60 ${
                  active ? "text-primary" : "text-muted hover:text-secondary"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="source-tab"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-[calc(var(--radius-control)-2px)] bg-surface shadow-sm dark:bg-raised"
                  />
                )}
                <span className="relative">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {sourceMode === "upload" ? (
          <Uploader file={file} onFile={setFile} disabled={running} />
        ) : (
          <LinkInput
            value={sourceUrl}
            onChange={setSourceUrl}
            disabled={running}
          />
        )}
        <button
          type="button"
          role="switch"
          aria-checked={isSampleRun}
          disabled={running}
          onClick={() => {
            const next = !isSampleRun;
            setUseSample(next);
            if (next) {
              setFile(null);
              setSourceUrl("");
            }
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
            isLocked={(code) => !langAllowed(code)}
            lockedNote={`${unlockName((f) => f.targetLanguages === "all")} — dub into every language`}
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
        <VoicePicker
          mode={voiceMode}
          onMode={(m) => {
            setVoiceMode(m);
            // A reference clip has no meaning without a voice to clone onto,
            // so switching to "a native speaker" drops it rather than keeping
            // a file the run will ignore.
            if (m === "native") setReference(null);
            markTouched("options");
          }}
          reference={reference}
          isModeLocked={(m) => !voiceModeAllowed(m)}
          lockTier={unlockName((f) => f.voiceModes.length > 1)}
          referenceLockTier={unlockName((f) => f.referenceVoice)}
          referenceLockedReason={
            canReference
              ? null
              : `Dubbing in a different voice is part of the ${unlockName((f) => f.referenceVoice)} plan.`
          }
          onReference={(f) => {
            setReference(f);
            markTouched("options");
          }}
        />
        <OptionToggle
          checked={keepBackground}
          disabled={!canKeepBackground}
          badge={
            canKeepBackground ? undefined : (
              <PlanLockBadge tier={unlockName((f) => f.keepBackground)} />
            )
          }
          onChange={(v) => {
            setKeepBackground(v);
            markTouched("options");
          }}
          title="Keep background & effects"
          description={
            canKeepBackground
              ? "Dub over the original music/ambience instead of replacing it; the original speech is removed (Demucs)."
              : `Keeping the original music & effects is part of the ${unlockName((f) => f.keepBackground)} plan.`
          }
          icon={
            <path d="M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          }
        />
        <OptionToggle
          checked={lipSyncAvailable && lipSync}
          disabled={!lipSyncAvailable || !canLipSync}
          badge={
            canLipSync ? undefined : (
              <PlanLockBadge tier={unlockName((f) => f.lipSync)} />
            )
          }
          onChange={(v) => {
            setLipSync(v);
            markTouched("options");
          }}
          accent="magenta"
          title="Lip sync (optional)"
          description={
            !canLipSync
              ? `Lip sync is part of the ${unlockName((f) => f.lipSync)} plan. Upgrade to reshape the speaker's mouth to the new speech.`
              : lipSyncAvailable
                ? "Reshape the speaker's mouth to match the translated speech."
                : "Not available on this deployment — dubs run without it."
          }
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
              disabled={running || !qualityAllowed(q.key)}
              title={
                qualityAllowed(q.key)
                  ? undefined
                  : `${q.label} quality is part of the ${unlockName((f) => f.qualities.includes(q.key))} plan`
              }
              className={`focusable relative flex-1 rounded-[10px] px-3 py-2 font-mono text-xs font-medium transition-colors ${
                qualityAllowed(q.key) ? "" : "cursor-not-allowed opacity-50"
              }`}
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
                className={`relative z-10 inline-flex items-center gap-1 ${quality === q.key ? "text-brand" : "text-muted hover:text-primary"}`}
              >
                {q.label}
                {!qualityAllowed(q.key) && (
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Locked">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                )}
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
    <div data-tour="tour-run" className="deep-card grain space-y-3 p-4">
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
            {/* What this run will actually charge. On a trimmed run that is the
                affordable part, not the whole clip — quoting `cost` there would
                name a price the user is not about to pay. */}
            <span
              className={
                short
                  ? "font-medium text-[rgb(var(--mesh-c))]"
                  : "font-medium text-white"
              }
            >
              {billableCost}
            </span>{" "}
            / {balance.toLocaleString()} cr
          </span>
        </span>
      </div>

      <MagneticButton
        onClick={start}
        disabled={busy || running || !canStart}
        title={
          walletEmpty
            ? "You have no credits left — buy credits or a plan to dub"
            : !canStart
              ? "Choose a source and a target language first"
              : undefined
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
                : walletEmpty
                  ? "No credits left"
                  : canStart
                    ? // On a trimmed run the button names the length too, so the
                      // cut is stated at the moment of committing to it and not
                      // only in the panel above.
                      willTrim
                      ? `Dub first ${formatSeconds(billableSeconds)} · ${billableCost} →`
                      : `Start dubbing · ${billableCost} →`
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
              <p>{error}</p>
              {/* A credit refusal is the one failure the user can fix from
                  here, so it ships with the fix attached rather than telling
                  them to go and find the Plans page. */}
              {needsCredits && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    to="/plans"
                    className="btn-primary focusable px-4 py-2 font-mono text-xs"
                  >
                    Buy credits →
                  </Link>
                  <Link
                    to="/plans"
                    className="btn-ghost focusable px-4 py-2 font-mono text-xs"
                  >
                    See plans
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── The trim warning ──────────────────────────────────────────────
          Shown BEFORE the run when the balance covers only part of the clip,
          and after it when the server reports the same thing (a link's length
          is only known server-side, so that is the only warning a link gets).

          This is the whole point of per-second pricing: a short wallet dubs
          the front of the video instead of being refused, and the user is told
          plainly — with the price of the rest — rather than left wondering why
          their five-minute upload came back a minute long. */}
      <AnimatePresence initial={false}>
        {(job?.billing?.trimmed || (!job && willTrim && sourceReadyForQuote)) && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.25, ease: EASE_ENTRANCE }}
            className="overflow-hidden"
          >
            <div className="card border-warn/30 bg-warn/10 px-5 py-4 text-sm">
              <p className="font-medium text-primary">
                {job?.billing?.trimmed
                  ? "Only part of this video was dubbed"
                  : "Your balance covers part of this video"}
              </p>
              <p className="mt-1 text-secondary">
                {job?.billing?.notice ??
                  `You have ${balance} credits, which covers ${formatSeconds(
                    billableSeconds,
                  )} of this ${formatSeconds(quotedSeconds)} video. ` +
                    `We'll dub the first ${formatSeconds(billableSeconds)} for ` +
                    `${billableCost} credits — the whole thing would cost ${cost}.`}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  to="/plans"
                  className="btn-primary focusable px-4 py-2 font-mono text-xs"
                >
                  Buy credits to dub it all →
                </Link>
              </div>
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
                      <span className="relative h-10 w-14 shrink-0 overflow-hidden rounded-lg">
                        <WorkThumb work={w} />
                      </span>
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
                  {/* mediaUrl(), not the raw path.
                      The pipeline returns `/media/outputs/<id>.mp4` — a path on
                      the DUBBING API's origin, which is not this one. Handed to
                      <video src> as-is it resolves against the Studio's own
                      origin, where /media is the SPA catch-all: index.html with
                      a video content type, so the player silently shows nothing
                      and both panels read "no media" after a dub that worked.
                      mediaUrl prepends VITE_DUB_API when that is absolute and
                      leaves the path alone when the two are same-origin (the
                      deployed single-container case), so one call is right in
                      both. My Works already did this; this panel and the
                      download link below were the two places that did not. */}
                  <VideoCompare
                    sourceUrl={mediaUrl(job.result.source_url)}
                    outputUrl={mediaUrl(job.result.output_url)}
                    simulated={job.simulated}
                  />
                </motion.div>
                {job.result.output_url && (
                  <motion.a
                    variants={rise}
                    href={mediaUrl(job.result.output_url)}
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
                  <SegmentTable
                    segments={job.result.segments}
                    onRevoice={completed ? revoice : undefined}
                    revoicing={revoicing}
                  />
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
          <div className="deep-card grain flex items-center gap-3 px-3.5 py-2.5">
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
    <span className="text-[13px] font-semibold tracking-tight text-primary">
      {children}
    </span>
  );
}
