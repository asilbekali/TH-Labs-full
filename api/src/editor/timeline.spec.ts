import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
  renderArgs,
  subtitleCues,
  toSrt,
  validateTracks,
  type Asset,
  type Track,
} from './timeline';

const asset = (over: Partial<Asset>): Asset => ({
  id: 'a',
  kind: 'audio',
  name: 'a',
  url: '/v1/media/a',
  duration: 10,
  has_audio: true,
  width: null,
  height: null,
  source: 'upload',
  text: null,
  peaks: [],
  ...over,
});

describe('validateTracks', () => {
  const assets = [
    asset({
      id: 'vid',
      kind: 'video',
      has_audio: false,
      width: 320,
      height: 240,
      duration: 4,
    }),
    asset({ id: 'voice', duration: 1.5 }),
  ];

  it('keeps a good timeline and clamps a trim to the file', () => {
    const [t] = validateTracks(assets, [
      {
        id: 't1',
        kind: 'voice',
        name: 'Voice',
        muted: false,
        volume: 1,
        clips: [
          {
            id: 'c1',
            asset_id: 'voice',
            start: 1,
            trim_in: 0,
            trim_out: 9,
            extra: 1,
          },
        ],
      },
    ]);
    expect(t.clips[0].trim_out).toBe(1.5);
    expect(t.clips[0]).not.toHaveProperty('extra');
  });

  it('refuses audio on a video track and unknown files', () => {
    const track = (asset_id: string, kind = 'video') => [
      {
        id: 't',
        kind,
        name: 'T',
        clips: [{ id: 'c', asset_id, start: 0, trim_out: 1 }],
      },
    ];
    expect(() => validateTracks(assets, track('voice'))).toThrow(
      /cannot go on/,
    );
    expect(() => validateTracks(assets, track('nope'))).toThrow(
      /not in this project/,
    );
  });
});

describe('renderArgs (real ffmpeg)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'render-'));
  const ff = (args: string[]) =>
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);
  const present = (() => {
    try {
      execFileSync('ffmpeg', ['-version']);
      return true;
    } catch {
      return false;
    }
  })();
  const maybe = present ? it : it.skip;

  maybe(
    'composites two cuts of an animation, a line of speech and music',
    () => {
      const files: Record<string, string> = {
        vid: path.join(dir, 'anim.mp4'),
        voice: path.join(dir, 'line.wav'),
        music: path.join(dir, 'music.mp3'),
      };
      ff([
        '-f',
        'lavfi',
        '-i',
        'testsrc=s=320x240:r=30:d=4',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        files.vid,
      ]);
      ff(['-f', 'lavfi', '-i', 'sine=f=440:d=1.5', files.voice]);
      ff(['-f', 'lavfi', '-i', 'sine=f=220:d=6', files.music]);
      const assets = [
        asset({
          id: 'vid',
          kind: 'video',
          has_audio: false,
          width: 320,
          height: 240,
          duration: 4,
        }),
        asset({ id: 'voice', duration: 1.5 }),
        asset({ id: 'music', duration: 6 }),
      ];
      const tracks: Track[] = [
        {
          id: 'v',
          kind: 'video',
          name: 'Video',
          muted: false,
          volume: 1,
          clips: [
            {
              id: 'c1',
              asset_id: 'vid',
              start: 0,
              trim_in: 0,
              trim_out: 2,
              volume: 1,
              fade_in: 0,
              fade_out: 0,
            },
            {
              id: 'c2',
              asset_id: 'vid',
              start: 2,
              trim_in: 3,
              trim_out: 4,
              volume: 1,
              fade_in: 0,
              fade_out: 0,
            },
          ],
        },
        {
          id: 's',
          kind: 'voice',
          name: 'Voice',
          muted: false,
          volume: 1,
          clips: [
            {
              id: 'c3',
              asset_id: 'voice',
              start: 0.5,
              trim_in: 0,
              trim_out: 1.5,
              volume: 1,
              fade_in: 0.1,
              fade_out: 0,
            },
          ],
        },
        {
          id: 'm',
          kind: 'music',
          name: 'Music',
          muted: false,
          volume: 1,
          clips: [
            {
              id: 'c4',
              asset_id: 'music',
              start: 0,
              trim_in: 0,
              trim_out: 3.5,
              volume: 0.3,
              fade_in: 0,
              fade_out: 1,
            },
          ],
        },
      ];
      tracks.push({
        id: 't',
        kind: 'text',
        name: 'Subtitles',
        muted: false,
        volume: 1,
        clips: [
          {
            id: 'c5',
            asset_id: '',
            start: 0.5,
            trim_in: 0,
            trim_out: 1.5,
            volume: 0,
            fade_in: 0,
            fade_out: 0,
            text: 'Salom dunyo',
          },
        ],
      });
      const out = path.join(dir, 'out.mp4');
      const srtFile = path.join(dir, 'subs.srt');
      // Embedded, not burned: whether this ffmpeg has libass varies by
      // machine, and an embedded track is what can be checked in the file.
      const { args, total, srt } = renderArgs(
        assets,
        tracks,
        (a) => files[a.id],
        out,
        { file: srtFile, burn: false },
      );
      writeFileSync(srtFile, srt!);
      expect(total).toBeCloseTo(3.5);
      ff(args.filter((a) => a !== '-progress' && a !== 'pipe:1'));
      const probe = execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,width',
        '-of',
        'json',
        out,
      ]).toString();
      const info = JSON.parse(probe) as {
        format: { duration: string };
        streams: { codec_type: string; width?: number }[];
      };
      expect(info.streams.map((s) => s.codec_type).sort()).toEqual([
        'audio',
        'subtitle',
        'video',
      ]);
      expect(info.streams.find((s) => s.codec_type === 'video')?.width).toBe(
        320,
      );
      expect(Number(info.format.duration)).toBeCloseTo(3.5, 0);
    },
  );
});

describe('subtitles and detached audio', () => {
  const assets = [
    asset({
      id: 'vid',
      kind: 'video',
      has_audio: true,
      width: 320,
      height: 240,
      duration: 4,
    }),
    asset({
      id: 'mute',
      kind: 'video',
      has_audio: false,
      width: 320,
      height: 240,
      duration: 4,
    }),
  ];

  it("lets a video's sound sit on an audio track, but not a silent video's", () => {
    const track = (asset_id: string) => [
      {
        id: 'a',
        kind: 'audio',
        name: 'Original audio',
        clips: [{ id: 'c', asset_id, start: 0, trim_out: 2 }],
      },
    ];
    expect(validateTracks(assets, track('vid'))[0].clips).toHaveLength(1);
    expect(() => validateTracks(assets, track('mute'))).toThrow(/cannot go on/);
  });

  it('keeps subtitle words, tidied, and refuses an empty one', () => {
    const [t] = validateTracks(assets, [
      {
        id: 's',
        kind: 'text',
        name: 'Subtitles',
        clips: [
          {
            id: 'c',
            start: 1,
            trim_out: 2,
            text: '  Salom   dunyo ',
            asset_id: 'ignored',
          },
        ],
      },
    ]);
    expect(t.clips[0]).toMatchObject({
      text: 'Salom dunyo',
      start: 1,
      trim_out: 2,
      asset_id: '',
    });
    expect(() =>
      validateTracks(assets, [
        {
          id: 's',
          kind: 'text',
          name: 'Subtitles',
          clips: [{ id: 'c', start: 0, trim_out: 1, text: ' ' }],
        },
      ]),
    ).toThrow(/no words/);
  });

  it('writes the cues as SRT, in time order', () => {
    const tracks: Track[] = [
      {
        id: 's',
        kind: 'text',
        name: 'S',
        muted: false,
        volume: 1,
        clips: [
          {
            id: 'b',
            asset_id: '',
            start: 3.5,
            trim_in: 0,
            trim_out: 1,
            volume: 0,
            fade_in: 0,
            fade_out: 0,
            text: 'Ikkinchi',
          },
          {
            id: 'a',
            asset_id: '',
            start: 0.25,
            trim_in: 0,
            trim_out: 2,
            volume: 0,
            fade_in: 0,
            fade_out: 0,
            text: 'Birinchi qator',
          },
        ],
      },
    ];
    expect(toSrt(subtitleCues(tracks))).toBe(
      '1\n00:00:00,250 --> 00:00:02,250\nBirinchi qator\n\n' +
        '2\n00:00:03,500 --> 00:00:04,500\nIkkinchi\n',
    );
  });
});
