// The video editor's timeline: what a project document may contain, and the
// ffmpeg command that renders it. Pure, so it is tested on its own.
//
// Every clip names an asset, where it sits on the timeline (`start`), which
// part of the asset plays (`trim_in`–`trim_out`), and how loud. Video clips
// stack bottom-up across video tracks: a later track covers an earlier one
// where both have picture.
//
// A video file may also sit on a sound track: that is its sound, detached
// from the picture (the editor does it when a video is added), so cutting the
// sound never cuts the picture. Subtitle clips live on `text` tracks: they
// have no file, only words, a start and a length (`trim_out`).
import { BadRequestException } from '@nestjs/common';

export type AssetKind = 'video' | 'audio';
export type TrackKind = 'video' | 'voice' | 'music' | 'audio' | 'text';

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  url: string;
  duration: number;
  has_audio: boolean;
  width: number | null;
  height: number | null;
  source: 'upload' | 'tts' | 'dub';
  /** The script a speech asset was made from. */
  text: string | null;
  /** Loudness envelope for the timeline, 0..1. */
  peaks: number[];
  /** Server path relative to the data dir. Never sent to the browser. */
  file?: string;
}

export interface Clip {
  id: string;
  asset_id: string;
  start: number;
  trim_in: number;
  trim_out: number;
  volume: number;
  fade_in: number;
  fade_out: number;
  label?: string | null;
  /** Subtitle clips only: the words shown. */
  text?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  volume: number;
  clips: Clip[];
}

export const MAX_TRACKS = 24;
export const MAX_CLIPS_PER_TRACK = 500;
export const MAX_TIMELINE_SECONDS = 3 * 60 * 60;
const KINDS: TrackKind[] = ['video', 'voice', 'music', 'audio', 'text'];
export const MAX_SUBTITLE_CHARS = 500;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export const clipLength = (c: Clip) => Math.max(0, c.trim_out - c.trim_in);

export function defaultTracks(newId: () => string): Track[] {
  return [
    {
      id: newId(),
      kind: 'video',
      name: 'Video',
      muted: false,
      volume: 1,
      clips: [],
    },
    {
      id: newId(),
      kind: 'voice',
      name: 'Voice',
      muted: false,
      volume: 1,
      clips: [],
    },
    {
      id: newId(),
      kind: 'music',
      name: 'Music',
      muted: false,
      volume: 1,
      clips: [],
    },
  ];
}

function num(v: unknown, what: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new BadRequestException(`${what} must be between ${min} and ${max}.`);
  }
  return n;
}

/**
 * Check a timeline the browser sent against the project's assets, and return
 * it normalised (unknown fields dropped, trims clamped to the asset). Throws a
 * 400 naming the problem.
 */
export function validateTracks(assets: Asset[], raw: unknown): Track[] {
  if (!Array.isArray(raw))
    throw new BadRequestException('tracks must be a list.');
  if (raw.length > MAX_TRACKS) {
    throw new BadRequestException(
      `A project can have at most ${MAX_TRACKS} tracks.`,
    );
  }
  const byId = new Map(assets.map((a) => [a.id, a]));
  return raw.map((t: Record<string, unknown>) => {
    if (!t || typeof t !== 'object')
      throw new BadRequestException('Bad track.');
    const kind = t.kind as TrackKind;
    if (!KINDS.includes(kind))
      throw new BadRequestException(`Unknown track kind "${String(t.kind)}".`);
    if (typeof t.id !== 'string' || !ID.test(t.id))
      throw new BadRequestException('Bad track id.');
    const name =
      (typeof t.name === 'string' ? t.name : '').slice(0, 60) || kind;
    const clipsRaw = Array.isArray(t.clips) ? t.clips : [];
    if (clipsRaw.length > MAX_CLIPS_PER_TRACK) {
      throw new BadRequestException(`Track "${name}" has too many clips.`);
    }
    const clips = clipsRaw.map((c: Record<string, unknown>) => {
      if (typeof c?.id !== 'string' || !ID.test(c.id))
        throw new BadRequestException('Bad clip id.');
      if (kind === 'text') return textClip(c, name);
      const asset = byId.get(String(c.asset_id));
      if (!asset) {
        throw new BadRequestException(
          `A clip on "${name}" uses a file that is not in this project.`,
        );
      }
      // Picture only on video tracks; sound tracks take audio files, and a
      // video file's sound once it has been detached from the picture.
      const fits =
        kind === 'video'
          ? asset.kind === 'video'
          : asset.kind === 'audio' || asset.has_audio;
      if (!fits) {
        throw new BadRequestException(
          `"${asset.name}" cannot go on the ${kind} track "${name}".`,
        );
      }
      const trimIn = num(c.trim_in ?? 0, 'trim_in', 0, asset.duration);
      const trimOut = Math.min(
        num(c.trim_out, 'trim_out', 0, MAX_TIMELINE_SECONDS),
        asset.duration,
      );
      if (trimOut - trimIn < 0.05) {
        throw new BadRequestException(
          `A clip of "${asset.name}" is shorter than 0.05 s.`,
        );
      }
      const start = num(c.start, 'start', 0, MAX_TIMELINE_SECONDS);
      if (start + (trimOut - trimIn) > MAX_TIMELINE_SECONDS) {
        throw new BadRequestException('The timeline can be at most 3 hours.');
      }
      return {
        id: c.id,
        asset_id: asset.id,
        start,
        trim_in: trimIn,
        trim_out: trimOut,
        volume: num(c.volume ?? 1, 'volume', 0, 4),
        fade_in: num(c.fade_in ?? 0, 'fade_in', 0, 30),
        fade_out: num(c.fade_out ?? 0, 'fade_out', 0, 30),
        label: typeof c.label === 'string' ? c.label.slice(0, 120) : null,
      } satisfies Clip;
    });
    return {
      id: t.id,
      kind,
      name,
      muted: t.muted === true,
      volume: num(t.volume ?? 1, 'track volume', 0, 4),
      clips,
    } satisfies Track;
  });
}

function textClip(c: Record<string, unknown>, track: string): Clip {
  const text = (typeof c.text === 'string' ? c.text : '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  if (!text) {
    throw new BadRequestException(`A subtitle on "${track}" has no words.`);
  }
  if (text.length > MAX_SUBTITLE_CHARS) {
    throw new BadRequestException(
      `A subtitle can be at most ${MAX_SUBTITLE_CHARS} characters.`,
    );
  }
  const start = num(c.start, 'start', 0, MAX_TIMELINE_SECONDS);
  const length = num(c.trim_out, 'subtitle length', 0.2, 60);
  if (start + length > MAX_TIMELINE_SECONDS) {
    throw new BadRequestException('The timeline can be at most 3 hours.');
  }
  return {
    id: c.id as string,
    asset_id: '',
    start,
    trim_in: 0,
    trim_out: length,
    volume: 0,
    fade_in: 0,
    fade_out: 0,
    label: null,
    text,
  };
}

/** Subtitle cues, in time order: [start, end, text]. */
export function subtitleCues(tracks: Track[]): [number, number, string][] {
  return tracks
    .filter((t) => t.kind === 'text' && !t.muted)
    .flatMap((t) => t.clips)
    .filter((c) => (c.text ?? '').trim())
    .map((c): [number, number, string] => [
      c.start,
      c.start + clipLength(c),
      c.text!,
    ])
    .sort((a, b) => a[0] - b[0]);
}

function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** The cues as an .srt document. */
export function toSrt(cues: [number, number, string][]): string {
  return cues
    .map(
      ([a, b, text], i) =>
        `${i + 1}\n${srtTime(a)} --> ${srtTime(b)}\n${text}\n`,
    )
    .join('\n');
}

/** A path made safe inside an ffmpeg filter argument. */
function filterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export function timelineLength(tracks: Track[]): number {
  let end = 0;
  for (const t of tracks)
    for (const c of t.clips) end = Math.max(end, c.start + clipLength(c));
  return end;
}

const even = (n: number) => Math.max(2, n - (n % 2));
const f3 = (v: number) => v.toFixed(3);

/**
 * ffmpeg arguments that render the timeline to `out`. `fileOf` maps an asset
 * to its absolute path. Returns the arguments and the rendered length.
 */
export function renderArgs(
  assets: Asset[],
  tracks: Track[],
  fileOf: (a: Asset) => string,
  out: string,
  subtitles?: {
    /** Where the caller writes `srt` before running ffmpeg. */
    file: string;
    /** Burn into the picture (needs ffmpeg with libass); else embed a track. */
    burn: boolean;
  },
): { args: string[]; total: number; srt: string | null } {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const active = tracks.filter((t) => !t.muted);
  const total = timelineLength(active);
  if (total <= 0)
    throw new BadRequestException('The timeline is empty. Add a clip first.');

  const videoClips = active
    .filter((t) => t.kind === 'video')
    .flatMap((t) => [...t.clips].sort((a, b) => a.start - b.start));
  const first = videoClips.length
    ? byId.get(videoClips[0].asset_id)
    : undefined;
  const w = even(first?.width ?? 1280);
  const h = even(first?.height ?? 720);
  const fps = 30;

  const inputs: string[] = [];
  const filters: string[] = [];
  const input = (a: Asset) => {
    inputs.push('-i', fileOf(a));
    return inputs.length / 2 - 1;
  };

  // Picture: a black canvas the length of the timeline, each video clip laid
  // over it from its start, bottom track first.
  filters.push(
    `color=c=black:s=${w}x${h}:r=${fps}:d=${f3(total)},format=yuv420p[base0]`,
  );
  let base = 'base0';
  videoClips.forEach((c, k) => {
    const i = input(byId.get(c.asset_id)!);
    filters.push(
      `[${i}:v]trim=start=${f3(c.trim_in)}:end=${f3(c.trim_out)},` +
        `setpts=PTS-STARTPTS+${f3(c.start)}/TB,` +
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${k}]`,
    );
    const next = `base${k + 1}`;
    filters.push(
      `[${base}][v${k}]overlay=eof_action=pass:` +
        `enable='between(t,${f3(c.start)},${f3(c.start + clipLength(c))})'[${next}]`,
    );
    base = next;
  });

  // Sound: every clip with audio, trimmed, faded, delayed to its start, and
  // mixed without normalisation so volumes mean what the sliders say.
  const fmt =
    'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const legs: string[] = [];
  for (const t of active) {
    if (t.kind === 'text') continue;
    for (const c of t.clips) {
      const a = byId.get(c.asset_id);
      const gain = c.volume * t.volume;
      if (!a?.has_audio || gain <= 0) continue;
      const i = input(a);
      const len = clipLength(c);
      const chain = [
        `atrim=start=${f3(c.trim_in)}:end=${f3(c.trim_out)}`,
        'asetpts=PTS-STARTPTS',
        fmt,
        `volume=${gain.toFixed(3)}`,
      ];
      if (c.fade_in > 0)
        chain.push(`afade=t=in:st=0:d=${f3(Math.min(c.fade_in, len))}`);
      if (c.fade_out > 0) {
        const d = Math.min(c.fade_out, len);
        chain.push(`afade=t=out:st=${f3(len - d)}:d=${f3(d)}`);
      }
      const ms = Math.round(c.start * 1000);
      if (ms > 0) chain.push(`adelay=${ms}:all=1`);
      const label = `a${legs.length}`;
      filters.push(`[${i}:a]${chain.join(',')}[${label}]`);
      legs.push(label);
    }
  }
  filters.push(
    legs.length
      ? `${legs.map((l) => `[${l}]`).join('')}amix=inputs=${legs.length}:normalize=0:duration=longest,` +
          `apad,atrim=end=${f3(total)},alimiter=limit=0.97[aout]`
      : `anullsrc=r=48000:cl=stereo,atrim=end=${f3(total)}[aout]`,
  );

  // Subtitles: burned into the picture where ffmpeg can draw text, otherwise
  // carried as a subtitle track players can switch on.
  const cues = subtitleCues(active);
  const srt = cues.length && subtitles ? toSrt(cues) : null;
  const subArgs: string[] = [];
  if (srt && subtitles) {
    if (subtitles.burn) {
      const size = Math.max(16, Math.round(h * 0.055));
      filters.push(
        `[${base}]subtitles=filename='${filterPath(subtitles.file)}':` +
          `force_style='FontSize=${size},PrimaryColour=&H00FFFFFF,` +
          `OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,` +
          `Alignment=2,MarginV=${Math.round(h * 0.06)}'[vsub]`,
      );
      base = 'vsub';
    } else {
      inputs.push('-i', subtitles.file);
      subArgs.push('-map', `${inputs.length / 2 - 1}:s`, '-c:s', 'mov_text');
    }
  }

  return {
    total,
    srt,
    args: [
      '-v',
      'error',
      '-progress',
      'pipe:1',
      '-nostats',
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      `[${base}]`,
      '-map',
      '[aout]',
      ...subArgs,
      '-t',
      f3(total),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      out,
    ],
  };
}
