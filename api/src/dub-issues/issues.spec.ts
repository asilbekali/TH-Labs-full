import type { PipelineJob } from '../pipeline/pipeline.service';
import { analyse } from './issues';

function job(overrides: Partial<PipelineJob> = {}): PipelineJob {
  return {
    id: 'abc123',
    status: 'completed',
    filename: 'clip.mp4',
    simulated: false,
    error: null,
    options: {
      source_lang: 'en',
      target_lang: 'uz',
      lip_sync: false,
      keep_background: true,
      quality: 'balanced',
    },
    stages: [
      {
        key: 'asr',
        label: 'Speech-to-Text',
        status: 'done',
        message: 'Done',
        detail: {},
      },
      {
        key: 'tts',
        label: 'Text-to-Speech',
        status: 'done',
        message: 'Done',
        detail: {},
      },
    ],
    result: {
      output_url: '/media/outputs/abc123.mp4',
      source_url: null,
      duration: 20,
      detected_source_lang: 'en',
      segments: [
        {
          id: 0,
          start: 0,
          end: 3,
          source_text: 'Hello everyone out there',
          target_text: 'Hammaga salom',
        },
        {
          id: 1,
          start: 4,
          end: 6,
          source_text: 'This is a test line',
          target_text: 'This is a test line',
        },
        {
          id: 2,
          start: 7,
          end: 8,
          source_text: 'Short one here',
          target_text: 'x'.repeat(60),
        },
        {
          id: 3,
          start: 9,
          end: 11,
          source_text: 'Nothing came back',
          target_text: '',
        },
      ],
    },
    ...overrides,
  };
}

describe('analyse', () => {
  it('names the lines behind each problem', () => {
    const codes = Object.fromEntries(analyse(job()).map((i) => [i.code, i]));
    expect(codes.untranslated.segment_ids).toEqual([3]);
    expect(codes.not_translated.segment_ids).toEqual([1]);
    expect(codes.rushed_lines.segment_ids).toEqual([2]);
    expect(codes.untranslated.action).toBe('edit_line');
  });

  it('reports missing voiced lines first, as errors', () => {
    const j = job();
    j.stages[1].message =
      '3 of 41 lines could not be synthesized — the rest was dubbed';
    const [first] = analyse(j);
    expect(first.code).toBe('missing_lines');
    expect(first.severity).toBe('error');
  });

  it('says where a failed dub stopped and offers a retry', () => {
    const j = job({ status: 'failed', error: 'boom' });
    j.stages[1].status = 'failed';
    j.stages[1].message = 'edge-tts error';
    const issues = analyse(j);
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toContain('Text-to-Speech');
    expect(issues[0].action).toBe('retry');
  });

  it('finds nothing wrong with a clean dub', () => {
    const j = job();
    j.result.segments = [j.result.segments[0]];
    expect(analyse(j)).toEqual([]);
  });
});
