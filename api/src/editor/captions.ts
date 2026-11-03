// Timed words → subtitle lines, the way CapCut's auto captions lay them out:
// short lines that start the moment their first word is said and end when
// their last word is, in order. Pure, so it is tested on its own.
//
// A new line starts when the current one
//   · ends a sentence (. ! ? …),
//   · is followed by a pause (the speaker stopped),
//   · has reached MAX_WORDS words or MAX_SECONDS seconds — unless the
//     sentence ends within the next ORPHAN_WORDS words, which then stay on
//     this line (a little longer) rather than sit alone on the next one.

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

export interface CaptionLine {
  start: number;
  end: number;
  text: string;
}

export const MAX_WORDS = 7;
export const MAX_SECONDS = 3.2;
export const PAUSE_SECONDS = 0.6;
export const ORPHAN_WORDS = 2;
// How far past MAX_SECONDS a line may run to keep a sentence's tail with it.
export const ORPHAN_GRACE_SECONDS = 1.5;
// A line shorter than this flickers past; it is held a little longer when
// the next line leaves room.
export const MIN_LINE_SECONDS = 0.6;

const SENTENCE_END = /[.!?…。！？]["')\]]*$/;

export function wordsToLines(words: TimedWord[]): CaptionLine[] {
  const clean = words
    .map((w) => ({ ...w, word: w.word.trim() }))
    .filter((w) => w.word && w.end >= w.start)
    .sort((a, b) => a.start - b.start);

  const lines: CaptionLine[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word).join(' '),
    });
    cur = [];
  };

  // Does the sentence end within the next ORPHAN_WORDS words from `i`, and
  // could the current line take them without growing too long?
  const tailFits = (i: number): boolean => {
    for (let k = i; k < Math.min(i + ORPHAN_WORDS, clean.length); k++) {
      if (k > i && clean[k].start - clean[k - 1].end > PAUSE_SECONDS)
        return false;
      if (SENTENCE_END.test(clean[k].word)) {
        return (
          cur.length + (k - i + 1) <= MAX_WORDS + ORPHAN_WORDS &&
          clean[k].end - cur[0].start <= MAX_SECONDS + ORPHAN_GRACE_SECONDS
        );
      }
    }
    return false;
  };

  clean.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev) {
      const pause = w.start - prev.end > PAUSE_SECONDS;
      const full =
        cur.length >= MAX_WORDS || w.end - cur[0].start > MAX_SECONDS;
      if (pause || (full && !tailFits(i))) flush();
    }
    cur.push(w);
    if (SENTENCE_END.test(w.word) && i < clean.length - 1) flush();
  });
  flush();

  // Hold very short lines on screen a little longer, never into the next one.
  return lines.map((line, i) => {
    const next = lines[i + 1]?.start ?? Infinity;
    const end = Math.max(
      line.end,
      Math.min(line.start + MIN_LINE_SECONDS, next),
    );
    return {
      start: round(line.start),
      end: round(end),
      text: line.text,
    };
  });
}

const round = (v: number) => Math.round(v * 1000) / 1000;
