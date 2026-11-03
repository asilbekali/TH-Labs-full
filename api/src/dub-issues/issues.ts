// What went wrong in a dub, and how to fix it — from the job the dubbing
// pipeline reports. Pure, so it is tested on its own (issues.spec.ts).
//
// A finished dub reports its problems only as stage messages ("3 of 41 lines
// could not be synthesized" in the TTS row), which says something is missing
// and nothing about where. This turns the job into a short list of issues,
// each with the lines it concerns and the fix to offer.
import type {
  PipelineJob,
  PipelineSegment,
} from '../pipeline/pipeline.service';

export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueAction =
  'edit_line' | 'retry' | 'upgrade' | 'buy_tokens' | 'reupload' | 'none';

export interface DubIssue {
  code: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fix: string;
  action: IssueAction;
  segment_ids: number[];
}

// Characters per second above which a line has to be squeezed hard to fit its
// slot — it sounds rushed or is cut at the next line. Speech is 12-16 cps.
const RUSHED_CPS = 21;
const LOW_SIMILARITY = 55;
const SHOW_IDS = 4;

const ids = (segs: PipelineSegment[]) => segs.map((s) => s.id);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function lineList(list: number[]): string {
  const shown = list
    .slice(0, SHOW_IDS)
    .map((i) => `#${i + 1}`)
    .join(', ');
  const more = list.length - SHOW_IDS;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

export function analyse(job: PipelineJob): DubIssue[] {
  const out: DubIssue[] = [];
  const stage = (key: string) => job.stages.find((s) => s.key === key);
  const segs = job.result.segments ?? [];

  if (job.status === 'failed') {
    const failed = job.stages.find((s) => s.status === 'failed');
    out.push({
      code: 'job_failed',
      severity: 'error',
      title: `The dub stopped at ${failed?.label ?? 'the pipeline'}`,
      detail: failed?.message || job.error || 'No output was written.',
      fix:
        'This is usually temporary. Start the dub again; if it fails at the same ' +
        'step twice, try a shorter clip or an MP4 (H.264) file. You were not ' +
        'charged for output that was never produced.',
      action: 'retry',
      segment_ids: [],
    });
    return out;
  }
  if (job.status !== 'completed') return out;

  const asr = stage('asr');
  if (!segs.length) {
    out.push({
      code: 'no_speech',
      severity: 'error',
      title: 'No speech was found in this video',
      detail: asr?.message || 'The recogniser heard nothing to translate.',
      fix:
        'Check the video has an audible voice. Loud music under the speech can ' +
        'hide it — pick the spoken language as the source instead of ' +
        'Auto-detect, or upload a cleaner cut.',
      action: 'reupload',
      segment_ids: [],
    });
    return out;
  }

  if (job.simulated) {
    out.push({
      code: 'simulated',
      severity: 'warning',
      title: 'Parts of this dub are a simulation',
      detail:
        'One or more AI engines were not available, so a labelled placeholder was used.',
      fix: 'Run it again in a few minutes, once the engines are back up.',
      action: 'retry',
      segment_ids: [],
    });
  }

  const empty = segs.filter(
    (s) => (s.source_text ?? '').trim() && !(s.target_text ?? '').trim(),
  );
  if (empty.length) {
    out.push({
      code: 'untranslated',
      severity: 'warning',
      title: `${empty.length} ${plural(empty.length, 'line has', 'lines have')} no translation (${lineList(ids(empty))})`,
      detail:
        'These lines were heard but came out of translation empty, so nothing is spoken there.',
      fix: 'Type the translation for each one and re-dub those lines.',
      action: 'edit_line',
      segment_ids: ids(empty),
    });
  }

  const src = (
    job.result.detected_source_lang ||
    job.options.source_lang ||
    ''
  ).toLowerCase();
  if (src && src !== 'auto' && src !== job.options.target_lang) {
    const copied = segs.filter(
      (s) =>
        (s.target_text ?? '').trim() &&
        s.target_text!.trim().toLowerCase() ===
          (s.source_text ?? '').trim().toLowerCase() &&
        s.source_text.split(/\s+/).length > 2,
    );
    if (copied.length) {
      out.push({
        code: 'not_translated',
        severity: 'warning',
        title: `${copied.length} ${plural(copied.length, 'line is', 'lines are')} still in the original language (${lineList(ids(copied))})`,
        detail:
          'The translation came back identical to what was said, so the dub repeats the original words.',
        fix: 'Rewrite those lines in the target language and re-dub them.',
        action: 'edit_line',
        segment_ids: ids(copied),
      });
    }
  }

  const tts = stage('tts');
  const ttsMsg = tts?.message ?? '';
  if (/could not be synthesized/.test(ttsMsg)) {
    out.push({
      code: 'missing_lines',
      severity: 'error',
      title: 'Some lines could not be voiced',
      detail: ttsMsg,
      fix:
        'Watch for the silent gaps and re-dub those lines. If one stays silent, ' +
        'simplify its text (spell out numbers and symbols, split a long sentence).',
      action: 'edit_line',
      segment_ids: [],
    });
  }

  const rushed = segs.filter((s) => {
    const text = (s.target_text ?? '').trim();
    return text && text.length / Math.max(s.end - s.start, 0.3) > RUSHED_CPS;
  });
  if (rushed.length) {
    out.push({
      code: 'rushed_lines',
      severity: 'warning',
      title: `${rushed.length} ${plural(rushed.length, 'line', 'lines')} may sound rushed or cut off (${lineList(ids(rushed))})`,
      detail:
        'The translation is much longer than the time the speaker took, so it was ' +
        'sped up to fit and may be clipped at the next line.',
      fix: "Shorten the wording, or widen the line's time window in the speech editor, then re-dub it.",
      action: 'edit_line',
      segment_ids: ids(rushed),
    });
  }

  if (/cloning unavailable|speaker match unavailable/.test(ttsMsg)) {
    out.push({
      code: 'clone_unavailable',
      severity: 'warning',
      title: "The original speaker's voice was not kept",
      detail:
        'Voice cloning was not available for this run, so a native voice was used.',
      fix: "Run the dub again later to get the speaker's own voice.",
      action: 'retry',
      segment_ids: [],
    });
  } else if (/speaker match off in Fast mode/.test(ttsMsg)) {
    out.push({
      code: 'clone_fast',
      severity: 'info',
      title: 'Fast quality uses a native voice',
      detail: "Matching the speaker's timbre is skipped at Fast quality.",
      fix: "Pick Balanced or Studio quality to keep the speaker's voice.",
      action: 'none',
      segment_ids: [],
    });
  }
  const sim = job.result.metrics?.speaker_similarity;
  if (
    tts?.detail?.voice_clone &&
    typeof sim === 'number' &&
    sim < LOW_SIMILARITY
  ) {
    out.push({
      code: 'low_similarity',
      severity: 'info',
      title: `Voice likeness is low (${Math.round(sim)}%)`,
      detail:
        'Background noise or several speakers in the reference make the cloned voice drift.',
      fix: 'Upload a clean 10-20 second clip of the speaker as a custom voice and dub again.',
      action: 'reupload',
      segment_ids: [],
    });
  }

  const sep = stage('separation');
  if (sep && /could not|failed/.test(sep.message ?? '')) {
    out.push({
      code: 'background_lost',
      severity: 'warning',
      title: 'Background music and effects were dropped',
      detail: sep.message,
      fix:
        'The dub plays with voice only. Run it again; if it repeats, the speech is ' +
        'too mixed into the music to separate.',
      action: 'retry',
      segment_ids: [],
    });
  }
  const lip = stage('lipsync');
  if (job.options.lip_sync && lip?.status === 'skipped') {
    out.push({
      code: 'lipsync_skipped',
      severity: 'info',
      title: 'Lip sync did not run',
      detail: lip.message || 'Lip sync is not available right now.',
      fix: 'The dub is complete without it. Try again later for lip sync.',
      action: 'none',
      segment_ids: [],
    });
  }
  if (job.billing?.trimmed) {
    out.push({
      code: 'trimmed',
      severity: 'info',
      title: 'Only part of the video was dubbed',
      detail: job.billing.notice || 'Your balance covered part of it.',
      fix: 'Top up tokens and dub the full video.',
      action: 'buy_tokens',
      segment_ids: [],
    });
  }

  const order: Record<IssueSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
