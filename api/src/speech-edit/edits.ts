// The arithmetic of a speech edit, kept free of I/O so it can be tested on
// its own (edits.spec.ts).
//
// A dub's audio is one track. To change one line without re-dubbing the rest:
//
//   1. silence the stretch of audio that line used to own,
//   2. lay the newly spoken line at its (possibly moved) start,
//   3. leave every other sample exactly as it was.
//
// A line "owns" the audio from its start up to where the next line starts (or
// the end of the video): the pipeline lets speech spill into the pause after
// it, but never into the next line, so that window holds this line and nothing
// else.
import { BadRequestException } from '@nestjs/common';

import type { PipelineSegment } from '../pipeline/pipeline.service';

export interface LineEdit {
  id: number;
  target_text?: string;
  start?: number;
  end?: number;
}

const MIN_LINE = 0.2;
// Speech faster than this is unintelligible; past it the line is cut instead.
const MAX_TEMPO = 1.6;

const squash = (s: string | null | undefined) =>
  (s ?? '').split(/\s+/).filter(Boolean).join(' ');

/**
 * The transcript after `edits`, and the ids that actually changed. Validates
 * timing so lines never overlap and keep their order. Throws a 400 with a
 * sentence the user can act on.
 */
export function applyEdits(
  segments: PipelineSegment[],
  edits: LineEdit[],
  duration: number,
): { segments: PipelineSegment[]; changed: number[] } {
  const next = segments.map((s) => ({ ...s }));
  const byId = new Map(next.map((s) => [s.id, s]));
  const changed = new Set<number>();
  const total = duration || (segments.at(-1)?.end ?? 0);

  for (const e of edits) {
    const seg = byId.get(e.id);
    if (!seg) {
      throw new BadRequestException(
        `Line ${e.id + 1} does not exist in this dub.`,
      );
    }
    if (e.target_text !== undefined) {
      const text = squash(e.target_text);
      if (text !== squash(seg.target_text)) {
        seg.target_text = text;
        changed.add(seg.id);
      }
    }
    if (e.start !== undefined || e.end !== undefined) {
      const start = round(e.start ?? seg.start);
      const end = round(e.end ?? seg.end);
      if (end - start < MIN_LINE) {
        throw new BadRequestException(
          `Line ${seg.id + 1} must be at least ${MIN_LINE} s long.`,
        );
      }
      if (start < 0 || (total && end > total + 0.05)) {
        throw new BadRequestException(
          `Line ${seg.id + 1} must stay inside the video (0 – ${total.toFixed(1)} s).`,
        );
      }
      if (
        Math.abs(start - seg.start) > 1e-3 ||
        Math.abs(end - seg.end) > 1e-3
      ) {
        seg.start = start;
        seg.end = end;
        changed.add(seg.id);
      }
    }
  }

  for (let i = 1; i < next.length; i++) {
    if (next[i].start < next[i - 1].end - 1e-3) {
      throw new BadRequestException(
        `Line ${next[i].id + 1} now overlaps line ${next[i - 1].id + 1}. ` +
          `Move it so it starts after ${next[i - 1].end.toFixed(2)} s.`,
      );
    }
  }
  return { segments: next, changed: [...changed].sort((a, b) => a - b) };
}

function round(v: number): number {
  return Math.round(Number(v) * 1000) / 1000;
}

/** Where the stretch a line owns ends: the next line's start, or the end. */
function windowEnd(segments: PipelineSegment[], id: number, total: number) {
  const i = segments.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < segments.length ? segments[i + 1].start : total;
}

export interface Placement {
  id: number;
  /** Where the new speech starts on the timeline. */
  at: number;
  /** How long it may run before the next line. */
  room: number;
  /** The line's text; empty means the line was cleared and stays silent. */
  text: string;
}

/**
 * What to silence and where to lay each changed line.
 *
 * Both windows of a moved line are silenced — the one it used to own and the
 * one it owns now — so neither old speech nor a gap from the move is heard.
 */
export function planSplice(
  before: PipelineSegment[],
  after: PipelineSegment[],
  changed: number[],
  total: number,
): { mutes: [number, number][]; placements: Placement[] } {
  const old = new Map(before.map((s) => [s.id, s]));
  const now = new Map(after.map((s) => [s.id, s]));
  const mutes: [number, number][] = [];
  const placements: Placement[] = [];
  for (const id of changed) {
    const o = old.get(id)!;
    const n = now.get(id)!;
    mutes.push([o.start, Math.max(windowEnd(before, id, total), o.end)]);
    mutes.push([n.start, Math.max(windowEnd(after, id, total), n.end)]);
    placements.push({
      id,
      at: n.start,
      room: Math.max(windowEnd(after, id, total) - n.start, MIN_LINE),
      text: squash(n.target_text),
    });
  }
  return { mutes: mergeIntervals(mutes), placements };
}

export function mergeIntervals(list: [number, number][]): [number, number][] {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export interface SpokenLine {
  file: string;
  at: number;
  room: number;
  /** Measured length of the spoken clip, seconds. */
  duration: number;
}

// The dub's own channel layout is kept. Converting a mono dub to stereo
// spreads its one channel at -3 dB, which made every UNTOUCHED line quieter
// than in the original — the opposite of "leave the rest alone".
const fmt = (layout: 'mono' | 'stereo') =>
  `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=${layout}`;
// A spoken line is mono. Into a stereo dub it is copied to both channels at
// full level rather than spread at -3 dB.
const lineFmt = (layout: 'mono' | 'stereo') =>
  layout === 'mono'
    ? fmt('mono')
    : `${fmt('mono')},pan=stereo|c0=c0|c1=c0,${fmt('stereo')}`;
const f3 = (v: number) => v.toFixed(3);

/**
 * ffmpeg arguments that write `out`: `video` with its picture copied as-is,
 * its audio silenced inside `mutes`, and each spoken line laid at its start —
 * sped up (to MAX_TEMPO) if it is longer than its room, then cut there.
 */
export function spliceArgs(
  video: string,
  mutes: [number, number][],
  lines: SpokenLine[],
  out: string,
  /** Audio channels of `video`; 1 keeps a mono dub mono. */
  channels = 2,
): string[] {
  const layout = channels === 1 ? 'mono' : 'stereo';
  const inputs = ['-i', video];
  const filters: string[] = [];

  const silence = mutes
    .map(([a, b]) => `volume=enable='between(t,${f3(a)},${f3(b)})':volume=0`)
    .join(',');
  filters.push(`[0:a]${fmt(layout)}${silence ? `,${silence}` : ''}[base]`);

  lines.forEach((line, i) => {
    inputs.push('-i', line.file);
    const chain = [lineFmt(layout)];
    const tempo =
      line.duration > line.room
        ? Math.min(line.duration / line.room, MAX_TEMPO)
        : 1;
    if (tempo > 1.001) chain.push(`atempo=${tempo.toFixed(3)}`);
    chain.push(`atrim=end=${f3(line.room)}`, 'asetpts=PTS-STARTPTS');
    chain.push('afade=t=in:st=0:d=0.015');
    const ms = Math.round(line.at * 1000);
    if (ms > 0) chain.push(`adelay=${ms}:all=1`);
    filters.push(`[${i + 1}:a]${chain.join(',')}[l${i}]`);
  });

  const mixIn = ['[base]', ...lines.map((_, i) => `[l${i}]`)].join('');
  filters.push(
    lines.length
      ? `${mixIn}amix=inputs=${lines.length + 1}:normalize=0:duration=first[aout]`
      : '[base]anull[aout]',
  );

  return [
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '0:v:0?',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    out,
  ];
}
