import { wordsToLines } from './captions';

const w = (word: string, start: number, end: number) => ({ word, start, end });

describe('wordsToLines', () => {
  it('starts a new line at a sentence end, keeping words in order', () => {
    const lines = wordsToLines([
      w('Salom', 0.2, 0.6),
      w('dunyo.', 0.7, 1.1),
      w('Bugun', 1.3, 1.6),
      w('yaxshi', 1.7, 2.0),
      w('kun.', 2.1, 2.4),
    ]);
    expect(lines).toEqual([
      { start: 0.2, end: 1.1, text: 'Salom dunyo.' },
      { start: 1.3, end: 2.4, text: 'Bugun yaxshi kun.' },
    ]);
  });

  it('breaks at a pause and at the word limit', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      w(`w${i}`, i * 0.3, i * 0.3 + 0.25),
    );
    const lines = wordsToLines([...many, w('after', 5, 5.3)]);
    expect(lines.map((l) => l.text)).toEqual([
      'w0 w1 w2 w3 w4 w5 w6',
      'w7 w8',
      'after',
    ]);
    expect(lines[0].start).toBe(0);
    expect(lines[2].start).toBe(5);
  });

  it("keeps a sentence's last word with its line instead of orphaning it", () => {
    // The words and times Whisper gave for a real recording.
    const lines = wordsToLines([
      w('Today', 2.1, 2.4),
      w('we', 2.4, 2.5),
      w('will', 2.5, 2.7),
      w('learn', 2.7, 3.0),
      w('how', 3.0, 3.3),
      w('neural', 3.3, 3.8),
      w('networks', 3.8, 4.5),
      w('work.', 4.5, 5.0),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      'Today we will learn how neural networks work.',
    ]);
  });

  it('holds a very short line a little longer, but not into the next', () => {
    const lines = wordsToLines([w('Ha.', 1, 1.1), w('Yo‘q', 1.5, 1.8)]);
    expect(lines[0]).toEqual({ start: 1, end: 1.5, text: 'Ha.' });
  });

  it('sorts words that arrive out of order and drops empty ones', () => {
    const lines = wordsToLines([
      w('ikki', 1, 1.2),
      w(' ', 0.5, 0.6),
      w('bir', 0.2, 0.4),
    ]);
    expect(lines.map((l) => l.text)).toEqual(['bir ikki']);
  });
});
