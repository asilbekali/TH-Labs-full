import { BadRequestException } from '@nestjs/common';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { PipelineSegment } from '../pipeline/pipeline.service';
import { applyEdits, mergeIntervals, planSplice, spliceArgs } from './edits';

const segs = (): PipelineSegment[] => [
  {
    id: 0,
    start: 0.5,
    end: 2,
    source_text: 'Hello there friend',
    target_text: "Salom do'stim",
  },
  {
    id: 1,
    start: 2.5,
    end: 4,
    source_text: 'How are you today',
    target_text: 'Bugun qalaysiz',
  },
  {
    id: 2,
    start: 15,
    end: 17,
    source_text: 'Goodbye now',
    target_text: 'Xayr',
  },
];

describe('applyEdits', () => {
  it('reports only lines that really changed, and leaves the input alone', () => {
    const before = segs();
    const { segments, changed } = applyEdits(
      before,
      [
        { id: 0, target_text: "Salom  do'stim" }, // whitespace only
        { id: 1, target_text: 'Bugun qandaysiz?' },
      ],
      20,
    );
    expect(changed).toEqual([1]);
    expect(segments[1].target_text).toBe('Bugun qandaysiz?');
    expect(before[1].target_text).toBe('Bugun qalaysiz');
  });

  it('moves a line in time but never over its neighbour or outside the video', () => {
    const moved = applyEdits(segs(), [{ id: 1, start: 2.2, end: 4.5 }], 20);
    expect(moved.changed).toEqual([1]);
    expect([moved.segments[1].start, moved.segments[1].end]).toEqual([
      2.2, 4.5,
    ]);
    expect(() => applyEdits(segs(), [{ id: 1, start: 1 }], 20)).toThrow(
      /overlaps/,
    );
    expect(() => applyEdits(segs(), [{ id: 2, end: 30 }], 20)).toThrow(
      /inside the video/,
    );
    expect(() => applyEdits(segs(), [{ id: 9, target_text: 'x' }], 20)).toThrow(
      BadRequestException,
    );
  });
});

describe('planSplice', () => {
  it('silences the old and the new window of a moved line', () => {
    const before = segs();
    const { segments, changed } = applyEdits(
      before,
      [{ id: 1, start: 3, end: 4.2 }],
      20,
    );
    const plan = planSplice(before, segments, changed, 20);
    // old window 2.5 → 15 (next line), new window 3 → 15: merged into one.
    expect(plan.mutes).toEqual([[2.5, 15]]);
    expect(plan.placements).toEqual([
      { id: 1, at: 3, room: 12, text: 'Bugun qalaysiz' },
    ]);
  });

  it('merges touching intervals', () => {
    expect(
      mergeIntervals([
        [5, 6],
        [1, 2],
        [1.5, 3],
      ]),
    ).toEqual([
      [1, 3],
      [5, 6],
    ]);
  });
});

describe('spliceArgs (real ffmpeg)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'splice-'));
  const run = (args: string[]) =>
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);
  // Loudness of a stretch of a file, in dB (silence is around -91).
  const level = (file: string, from: number, to: number): number => {
    // volumedetect reports on stderr, which execFileSync does not return.
    const out = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-ss',
        String(from),
        '-to',
        String(to),
        '-i',
        file,
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' },
    ).stderr;
    return Number(/mean_volume: (-?[\d.]+) dB/.exec(out)?.[1] ?? -100);
  };
  const ffmpegPresent = (() => {
    try {
      execFileSync('ffmpeg', ['-version']);
      return true;
    } catch {
      return false;
    }
  })();
  const maybe = ffmpegPresent ? it : it.skip;

  maybe(
    'keeps everything outside the edited window and lays the new line in',
    () => {
      const video = path.join(dir, 'dub.mp4');
      run([
        '-f',
        'lavfi',
        '-i',
        'testsrc=s=160x120:r=10:d=10',
        '-f',
        'lavfi',
        '-i',
        'sine=f=300:d=10',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        video,
      ]);
      const line = path.join(dir, 'line.wav');
      run(['-f', 'lavfi', '-i', 'sine=f=800:d=1', line]);
      const out = path.join(dir, 'out.mp4');
      // Mute 3-6 s and put the 1 s line at 4 s.
      run(
        spliceArgs(
          video,
          [[3, 6]],
          [{ file: line, at: 4, room: 2, duration: 1 }],
          out,
          1, // the test dub is mono, as the service would probe it
        ),
      );

      // untouched audio keeps its exact level (a mono dub stays mono)
      expect(Math.abs(level(out, 1, 2.5) - level(video, 1, 2.5))).toBeLessThan(
        0.5,
      );
      expect(Math.abs(level(out, 7, 9) - level(video, 7, 9))).toBeLessThan(0.5);
      expect(level(out, 3.2, 3.8)).toBeLessThan(-70); // silenced old speech
      expect(level(out, 4.2, 4.8)).toBeGreaterThan(-40); // the new line
      expect(level(out, 5.3, 5.9)).toBeLessThan(-70); // silence after it
      expect(level(out, 7, 9)).toBeGreaterThan(-40); // untouched audio
    },
  );
});
