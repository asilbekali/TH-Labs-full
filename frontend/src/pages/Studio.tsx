// The Studio (02).
//
// One short column that reads from top to bottom: choose a video, choose a
// language, start. Everything else has a working default and is folded away
// under "More options". Once a run starts, the column is the run and then its
// result, and the rest goes away.
//
// The pipeline logic below — the credit gate, job creation, SSE/polling, the
// mirror into the works library — lives in this component too; the presentation
// starts at the "Presentation" block.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import Uploader from "../components/Uploader";
import LinkInput, { readLink } from "../components/LinkInput";
import LanguageSelect from "../components/LanguageSelect";
import OptionToggle from "../components/OptionToggle";
import VideoCompare from "../components/VideoCompare";
import SegmentTable from "../components/SegmentTable";
import IssuesPanel from "../components/IssuesPanel";
import { getDubIssues } from "../lib/tools-api";
import type { Issue } from "../lib/types";
import { PLAN_LABEL, TOOL_PLAN, usePlan } from "../lib/plan";
import ResultMetrics from "../components/ResultMetrics";
import AnimatedNumber from "../components/AnimatedNumber";
import ScrollColumn from "../components/layout/ScrollColumn";
import Page from "../components/Page";
import MagneticButton from "../components/MagneticButton";
import VoicePicker, {
  PlanLockBadge,
  voiceModeLabel,
  type VoiceMode,
} from "../components/studio/VoicePicker";
import ThinkingOrbs from "../components/ThinkingOrbs";
import TourOverlay from "../components/onboarding/TourOverlay";
import type { TourStep } from "../components/onboarding/TourOverlay";
import { EASE_ENTRANCE } from "../lib/motion";
import { EDITOR_SHAPE } from "../lib/shape";
import { useConfirm } from "../components/ConfirmDialog";
import {
  AuthRequiredError,
  PaymentRequiredError,
  createJob,
  getJob,
  mediaUrl,
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
import { useWorks } from "../lib/works";

const QUALITIES = [
  { key: "fast", label: "Fast" },
  { key: "balanced", label: "Balanced" },
  { key: "studio", label: "Studio" },
];

const SAMPLE_LANGS = ["uz", "ru", "es", "fr", "de"];

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
  const plan = usePlan();
  // Subtitles+ is Pro and up; the server refuses it below that too.
  const canSubtitles = plan.loading || plan.has("subtitles");
  const { works, ready: worksReady, addWork, updateWork, removeWork } = useWorks();
  const [confirmDialog, confirm] = useConfirm();
  const { user, ready: authReady } = useAuth();

  // Cached by TanStack Query, so switching pages does not refetch the catalog
  // and the health chip stays live across the whole session.
  const { data: languages = [] } = useLanguages();
  const { data: health = null } = useHealth();
  // The live tariff (credits per minute, per quality). Public and cached, so the
  // estimate line quotes the server's prices rather than a bundled copy that
  // silently goes stale after a price change.
  const { data: plansCatalog } = usePlans();
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
  const [subtitles, setSubtitles] = useState(false);
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
    if (!canSubtitles && subtitles) setSubtitles(false);
  }, [
    canSubtitles,
    subtitles,
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

  // One dub at a time, until it reaches 100%. The run lives in this page's
  // state, so leaving Studio, reloading, or the shell remounting it while the
  // session refreshes would drop it and show an empty form mid-dub. So a dub
  // still running in My works is picked up again here: its progress is shown
  // and a new one cannot be started until it finishes, fails or is cancelled.
  const resumingRef = useRef(false);
  useEffect(() => {
    if (job || busy || !worksReady || resumingRef.current) return;
    const live = works.find((w) => w.status === "processing");
    if (!live) return;
    resumingRef.current = true;
    getJob(live.id)
      .then((j) => {
        setJob(j);
        savedRef.current = j.id;
        if (j.status !== "queued" && j.status !== "running") return;
        unsubRef.current?.();
        const stopSse = subscribeJob(
          j.id,
          (evt) => setJob(evt.job),
          () => {
            unsubRef.current = pollJob(j.id, (next) => setJob(next));
          },
        );
        unsubRef.current = stopSse;
      })
      .catch((e) => {
        // The pipeline no longer knows this job (it restarted mid-run), so it
        // will never finish: close it out rather than block Studio forever.
        if (e instanceof AuthRequiredError) return;
        updateWork(live.id, {
          status: "failed",
          error: "This dub was interrupted. Please start it again.",
          progress: null,
          stage: null,
        });
      })
      .finally(() => {
        resumingRef.current = false;
      });
  }, [job, busy, works, worksReady, updateWork]);

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
  // What went wrong in this dub and how to fix it — the account API reads the
  // finished job and answers (GET /v1/dub-issues/:jobId).
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const finishedId = completed || failed ? job?.id : undefined;
  useEffect(() => {
    setIssues(null);
    if (!finishedId) return;
    let live = true;
    getDubIssues(finishedId)
      .then((list) => live && setIssues(list))
      .catch(() => live && setIssues(null));
    return () => {
      live = false;
    };
  }, [finishedId]);

  const overall = useMemo(() => {
    if (!job) return 0;
    const active = job.stages.filter((s) => s.status !== "skipped");
    if (!active.length) return 0;
    return Math.round(
      (active.reduce((a, s) => a + s.progress, 0) / active.length) * 100,
    );
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

  async function start() {
    // The options a plan can lock, as the gate checks them.
    const dubFeatures = {
      targetLang,
      voiceMode,
      voiceClone,
      referenceVoice: !!reference,
      keepBackground,
      lipSync: lipSyncAvailable && lipSync,
      subtitles: canSubtitles && subtitles,
    };
    setError(null);
    setNeedsCredits(false);
    // One dub at a time (see the resume effect above).
    if (works.some((w) => w.status === "processing")) {
      setError("Your current dub is still running. Wait for it to finish, or cancel it.");
      return;
    }
    // Server-authoritative gate. Read-only — it charges nothing.
    //
    // A refusal here now means only one thing: the balance buys no dubbing at
    // all. A balance that covers PART of the clip is allowed through, and the
    // server trims the source to what was paid for — so the job still runs and
    // the user gets the part of their video they can afford rather than an error.
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
          `You have ${gate.balance} tokens — not enough to dub any of this ` +
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
            : "Could not verify your tokens.",
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
        subtitles,
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

  // Cancel a running dub. The pipeline has no way to be told to stop, so this
  // stops following the job and deletes it from the account (My works and the
  // database, via removeWork) — the result is never shown or kept.
  async function cancelDub() {
    if (!job) return;
    const ok = await confirm({
      title: "Cancel this dub?",
      body: "It is deleted from your account and will not appear in My works. Tokens already charged for it are not returned.",
      confirmLabel: "Cancel dub",
      cancelLabel: "Keep dubbing",
      danger: true,
    });
    if (!ok) return;
    const id = job.id;
    savedRef.current = null;
    reset();
    removeWork(id);
  }

  // ── Presentation-only state (no pipeline logic) ──────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);

  // Back to the top when a run begins or the status changes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
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

  const [moreOpen, setMoreOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // A local preview of the chosen upload for the clip row.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith("video")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Whether this deployment can actually lip-sync, straight from /health:
  // Wav2Lip is optional and usually absent, and a toggle that silently does
  // nothing is worse than one that says it cannot.
  const lipSyncAvailable =
    health?.stages.some((s) => s.key === "lipsync" && s.mode === "real") ??
    false;

  const optionSummary = [
    voiceModeLabel(voiceMode),
    reference ? "Custom voice" : null,
    keepBackground ? "Keeps music" : "No music",
    lipSyncAvailable && lipSync ? "Lip sync" : null,
    subtitles ? "Subtitles" : null,
    QUALITIES.find((q) => q.key === quality)?.label,
  ]
    .filter(Boolean)
    .join(" · ");

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
        body: "Dubbing a video takes three steps: choose a video, choose a language, press Start.",
        note: "← → to move · Esc to leave",
      },
      {
        id: "source",
        target: "tour-source",
        prefer: "right",
        title: "1 · Choose your video",
        body: "Drop a video here, click to pick one, or paste a link. No video yet? Try the sample clip.",
      },
      {
        id: "languages",
        target: "tour-languages",
        prefer: "right",
        title: "2 · Choose a language",
        body: "Pick the language you want to hear. We work out the language of the video for you.",
      },
      {
        id: "options",
        target: "tour-options",
        prefer: "right",
        title: "More options",
        body: "You can skip this. The voice, music, subtitles and quality are already set for most videos.",
      },
      {
        id: "run",
        target: "tour-run",
        prefer: "top",
        title: "3 · Start the dub",
        body: "You see the price before you start. Press the button and we do the rest.",
      },
      {
        id: "done",
        title: "That is all",
        body: "Every finished dub is saved in My works. Open this guide again any time with the Guide button.",
      },
    ],
    [],
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Presentation
  //
  // One short column, read from top to bottom. Nothing below reaches into the
  // pipeline: every value it draws was computed above.
  // ═══════════════════════════════════════════════════════════════════════

  const header = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-primary">
          {!job
            ? "Dub your video"
            : completed
              ? "Your dub is ready"
              : failed
                ? "This dub did not finish"
                : "Dubbing your video"}
        </h1>
        {!job && (
          <p className="mt-0.5 text-sm text-secondary">
            Choose a video, pick a language, press Start.
          </p>
        )}
      </div>
      {!job && (
        <button
          type="button"
          onClick={() => setTourOpen(true)}
          title="Show the walkthrough"
          className={`focusable shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
            tourSeen
              ? "border-subtle text-secondary hover:border-strong hover:text-primary"
              : "border-strong bg-sunken text-primary"
          }`}
        >
          Guide
        </button>
      )}
    </div>
  );

  const clipRow = (
    <div className="flex items-center gap-3">
      <div className="relative grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-black">
        {previewUrl ? (
          <video src={`${previewUrl}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 4l14 8-14 8z" />
          </svg>
        )}
        {sourceSeconds != null && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
            {formatSeconds(sourceSeconds)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-primary" title={file?.name}>
          {file ? file.name : "Sample clip"}
        </p>
        <p className="truncate text-[13px] text-muted">
          {file ? `${(file.size / 1_048_576).toFixed(1)} MB` : "25 seconds"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setFile(null);
          setUseSample(false);
        }}
        className="btn-ghost focusable shrink-0 rounded-full! px-4 py-2 text-[13px]"
      >
        Change
      </button>
    </div>
  );

  const sourceCard = (
    <Step n={1} title="Choose your video" tour="tour-source">
      {file || isSampleRun ? (
        clipRow
      ) : (
        <div className="space-y-3">
          {/* Two ways in, as tabs rather than two always-visible fields: only one
              can be sent, and showing both filled-in invites the question of
              which one wins. */}
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
                  onClick={() => setSourceMode(tab.id)}
                  className={`focusable relative flex-1 rounded-[calc(var(--radius-control)-2px)] px-3 py-2 text-[13px] font-medium transition-colors ${
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
            <Uploader file={file} onFile={setFile} />
          ) : (
            <LinkInput value={sourceUrl} onChange={setSourceUrl} />
          )}

          <button
            type="button"
            onClick={() => {
              setUseSample(true);
              setFile(null);
              setSourceUrl("");
            }}
            className="focusable block w-full text-center text-[13px] text-secondary underline underline-offset-2 hover:text-primary"
          >
            No video? Try our sample clip
          </button>
        </div>
      )}
    </Step>
  );

  const languageCard = (
    // Above the cards after it: glass cards are stacking contexts, so the
    // language list would otherwise open underneath them.
    <Step n={2} title="Choose a language" tour="tour-languages" className="relative z-20">
      <LanguageSelect
        label="Dub into"
        languages={languages}
        isLocked={(code) => !langAllowed(code)}
        lockedNote={`${unlockName((f) => f.targetLanguages === "all")} — dub into every language`}
        value={targetLang}
        onChange={setTargetLang}
      />
      {sampleLangNote && (
        <p className="mt-3 rounded-[10px] border border-warn/25 bg-warn/[0.07] px-3 py-2.5 text-[13px] leading-relaxed text-warn">
          The sample clip only has Uzbek, Russian, Spanish, French and German.
          Pick one of those, or use your own video.
        </p>
      )}
    </Step>
  );

  const moreOptions = (
    <section data-tour="tour-options" className="card relative z-10">
      <button
        type="button"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((v) => !v)}
        className="focusable flex w-full items-center gap-3 rounded-[var(--radius-card)] px-5 py-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-primary">More options</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">{optionSummary}</span>
        </span>
        <Chevron open={moreOpen} />
      </button>
      {moreOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="space-y-5 border-t border-subtle px-5 py-5"
        >
          <div className="relative z-20">
            <LanguageSelect
              label="Language in the video"
              languages={languages}
              value={sourceLang}
              onChange={setSourceLang}
              allowAuto
            />
          </div>

          <OptionGroup title="Voice">
            <VoicePicker
              mode={voiceMode}
              onMode={(m) => {
                setVoiceMode(m);
                // A reference clip has no meaning without a voice to clone onto,
                // so switching to "a native speaker" drops it rather than keeping
                // a file the run will ignore.
                if (m === "native") setReference(null);
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
              onReference={setReference}
            />
          </OptionGroup>

          <OptionGroup title="Sound and subtitles">
            <div className="space-y-2">
              <OptionToggle
                checked={keepBackground}
                disabled={!canKeepBackground}
                badge={
                  canKeepBackground ? undefined : (
                    <PlanLockBadge tier={unlockName((f) => f.keepBackground)} />
                  )
                }
                onChange={setKeepBackground}
                title="Keep music and sounds"
                description={
                  canKeepBackground
                    ? "Only the speech changes. The music and background sounds stay."
                    : `Keeping the music and sounds is part of the ${unlockName((f) => f.keepBackground)} plan.`
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
                onChange={setLipSync}
                title="Match the lips"
                description={
                  !canLipSync
                    ? `Lip sync is part of the ${unlockName((f) => f.lipSync)} plan.`
                    : lipSyncAvailable
                      ? "Moves the speaker's mouth to match the new speech."
                      : "Not available right now."
                }
              />
              <OptionToggle
                checked={canSubtitles && subtitles}
                disabled={!canSubtitles}
                badge={
                  canSubtitles ? undefined : (
                    <PlanLockBadge tier={PLAN_LABEL[TOOL_PLAN.subtitles]} />
                  )
                }
                onChange={setSubtitles}
                title="Add subtitles"
                description={
                  canSubtitles
                    ? "Shows subtitles on the video, and gives you a subtitle file."
                    : "Subtitles are part of the Pro plan."
                }
              />
            </div>
          </OptionGroup>

          <OptionGroup title="Quality">
            <div className="flex rounded-control border border-subtle bg-sunken p-1">
              {QUALITIES.map((q) => (
                <button
                  key={q.key}
                  onClick={() => setQuality(q.key)}
                  disabled={!qualityAllowed(q.key)}
                  title={
                    qualityAllowed(q.key)
                      ? undefined
                      : `${q.label} quality is part of the ${unlockName((f) => f.qualities.includes(q.key))} plan`
                  }
                  className={`focusable relative flex-1 rounded-[8px] px-3 py-2 text-[13px] font-medium transition-colors ${
                    qualityAllowed(q.key) ? "" : "cursor-not-allowed opacity-50"
                  }`}
                >
                  {quality === q.key && (
                    <motion.span
                      layoutId="quality-pill"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-[8px] bg-brand/15 shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.45)]"
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
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              {quality === "fast" &&
                "Quickest, but does not copy the speaker's voice. Good for long videos."}
              {quality === "balanced" && "Good quality for most videos."}
              {quality === "studio" && "Best quality, but takes the longest."}
            </p>
          </OptionGroup>
        </motion.div>
      )}
    </section>
  );

  // Two notices that can appear both before a run and after it.
  const notices = (
    <>
      {error && (
        <div className="card border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger">
          <p>{error}</p>
          {/* A credit refusal is the one failure the user can fix from here, so
              it ships with the fix attached. */}
          {needsCredits && (
            <Link to="/plans" className="btn-primary focusable mt-3 inline-flex px-4 py-2 text-[13px]">
              Buy tokens
            </Link>
          )}
        </div>
      )}

      {/* The trim warning: shown BEFORE the run when the balance covers only
          part of the clip, and after it when the server reports the same thing
          (a link's length is only known server-side). A short wallet dubs the
          front of the video instead of being refused, and the user is told so
          rather than left wondering why the dub came back short. */}
      {(job?.billing?.trimmed || (!job && willTrim && sourceReadyForQuote && !walletEmpty)) && (
        <div className="card border-warn/30 bg-warn/10 px-5 py-4 text-sm">
          <p className="font-medium text-primary">
            {job?.billing?.trimmed
              ? "Only part of this video was dubbed"
              : "You do not have enough tokens for the whole video"}
          </p>
          <p className="mt-1 text-secondary">
            {job?.billing?.notice ??
              `We will dub the first ${formatSeconds(billableSeconds)} for ` +
                `${billableCost} tokens. The whole video costs ${cost} tokens.`}
          </p>
          <Link to="/plans" className="btn-primary focusable mt-3 inline-flex px-4 py-2 text-[13px]">
            Buy tokens
          </Link>
        </div>
      )}
    </>
  );

  // ── The run card ─────────────────────────────────────────────────────────
  // The one coloured surface on the screen: dark in dark mode, warm copper
  // paper in light mode (.run-card in index.css).
  const runCard = (
    <section data-tour="tour-run" className="deep-card run-card space-y-4 p-5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] on-deep-dim">This run</p>
          {sourceReady ? (
            <p className="text-2xl font-semibold tracking-tight">
              {/* What this run will actually charge. On a trimmed run that is
                  the affordable part, not the whole clip. A link or the sample
                  has no measured length, so its price is an estimate. */}
              {sourceSeconds == null && "About "}
              <AnimatedNumber value={billableCost} /> tokens
            </p>
          ) : (
            <p className="text-[15px] font-medium">Choose a video to see the price</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[13px] on-deep-dim">You have</p>
          <p className="text-[15px] font-medium">{balance.toLocaleString()} tokens</p>
        </div>
      </div>

      <MagneticButton
        onClick={start}
        disabled={busy || !canStart}
        title={
          walletEmpty
            ? "You have no tokens left — buy tokens or a plan to dub"
            : !canStart
              ? "Choose a video first"
              : undefined
        }
        className="btn-primary focusable w-full py-3.5 text-[15px]"
      >
        <span className="flex items-center justify-center gap-2">
          {busy && <ThinkingOrbs size={18} speed={6.5} />}
          {busy
            ? "Starting…"
            : walletEmpty
              ? "No tokens left"
              : !canStart
                ? "Choose a video to start"
                : willTrim
                  ? // On a trimmed run the button names the length too, so the
                    // cut is stated at the moment of committing to it.
                    `Dub the first ${formatSeconds(billableSeconds)}`
                  : "Start dubbing"}
        </span>
      </MagneticButton>

      {walletEmpty && (
        <Link to="/plans" className="btn-ghost focusable block rounded-full! py-2.5 text-center text-sm">
          Buy tokens
        </Link>
      )}
    </section>
  );

  // ── While it runs ────────────────────────────────────────────────────────
  const runningCard = (
    <div className="card running-halo relative overflow-hidden p-6">
      <span className="beam" aria-hidden />
      <div className="flex items-center gap-4">
        <ThinkingOrbs size={64} speed={11} label="Dubbing your video" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-primary">
            {overall > 0 ? "Working on it…" : "Starting soon…"}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            Keep this page open until it finishes.
          </p>
        </div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-sunken">
        <motion.div
          className="h-full rounded-full bg-brand"
          initial={false}
          animate={{ width: `${overall}%` }}
          transition={{ duration: 0.5, ease: EASE_ENTRANCE }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[13px] text-muted">
        <span className="font-medium text-primary">{overall}%</span>
        <span>{fmtElapsed(elapsed)}</span>
      </div>
      <button
        type="button"
        onClick={() => void cancelDub()}
        className="btn-ghost focusable mt-4 w-full rounded-full! py-2.5 text-sm text-danger"
      >
        Cancel dubbing
      </button>
      {confirmDialog}
    </div>
  );

  const issuesPanel = job && !!issues?.length && (
    <IssuesPanel
      issues={issues}
      segments={job.result.segments}
      canEditLines={plan.isMax}
      editorHref={`/editor/${job.id}`}
      onRetry={() => void start()}
    />
  );

  const failedCard = (
    <>
      <div className="card p-5">
        <p className="text-sm text-secondary">
          Something went wrong with this video. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="btn-primary focusable mt-4 px-5 py-2.5 text-sm"
        >
          Try again
        </button>
      </div>
      {issuesPanel}
    </>
  );

  // ── The result ───────────────────────────────────────────────────────────
  const resultView = job && (
    <>
      {/* mediaUrl(), not the raw path: the pipeline returns a path on the
          DUBBING API's origin, which is not this one. Handed to <video src>
          as-is it resolves to the SPA catch-all and the player shows nothing. */}
      <VideoCompare
        sourceUrl={mediaUrl(job.result.source_url)}
        outputUrl={mediaUrl(job.result.output_url)}
        simulated={job.simulated}
        // Burned-in subtitles are already in the picture; a track on top would
        // show every line twice.
        subtitlesUrl={
          job.result.subtitles_burned
            ? undefined
            : mediaUrl(job.result.subtitles_vtt_url ?? null)
        }
        subtitlesLang={job.options.target_lang}
      />

      <div className="flex flex-wrap items-center gap-2">
        {job.result.output_url && (
          <a
            href={mediaUrl(job.result.output_url)}
            download
            className="btn-primary focusable inline-flex px-6 py-3 text-sm"
          >
            Download video
          </a>
        )}
        <button
          type="button"
          onClick={reset}
          className="btn-ghost focusable rounded-full! px-5 py-3 text-sm"
        >
          New dub
        </button>
        {job.result.subtitles_url && (
          <a
            href={mediaUrl(job.result.subtitles_url)}
            download
            className="btn-ghost focusable inline-flex rounded-full! px-5 py-3 text-sm"
          >
            Download subtitles
          </a>
        )}
        {plan.isMax && (
          <Link
            to={`/editor/${job.id}`}
            className="btn-ghost focusable inline-flex rounded-full! px-5 py-3 text-sm"
          >
            Speech editor
          </Link>
        )}
      </div>

      {issuesPanel}

      <section className="card">
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
          className="focusable flex w-full items-center gap-3 rounded-[var(--radius-card)] px-5 py-4 text-left"
        >
          <span className="flex-1 text-sm font-semibold text-primary">Edit the translation</span>
          <Chevron open={detailsOpen} />
        </button>
        {detailsOpen && (
          <div className="space-y-4 border-t border-subtle p-4">
            <SegmentTable
              segments={job.result.segments}
              onRevoice={revoice}
              revoicing={revoicing}
            />
            <ResultMetrics m={job.result.metrics} />
          </div>
        )}
      </section>
    </>
  );

  return (
    <Page className="h-full min-h-0" style={EDITOR_SHAPE}>
      <ScrollColumn ref={scrollRef}>
        <div className="mx-auto w-full max-w-[680px] space-y-3 pb-6">
          {header}
          {!job ? (
            <>
              {sourceCard}
              {languageCard}
              {moreOptions}
              {notices}
              {runCard}
            </>
          ) : (
            <>
              {notices}
              {completed ? resultView : failed ? failedCard : runningCard}
            </>
          )}
        </div>
      </ScrollColumn>
      <TourOverlay steps={tourSteps} open={tourOpen} onClose={closeTour} />
    </Page>
  );
}

// ── Small presentational helpers ───────────────────────────────────────────
function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// One numbered step of the page.
function Step({
  n,
  title,
  tour,
  className = "",
  children,
}: {
  n: number;
  title: string;
  tour: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-tour={tour} className={`card p-5 ${className}`}>
      <h2 className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold text-primary">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] bg-brand/12 text-[13px] text-brand">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function OptionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold text-primary">{title}</h3>
      {children}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
