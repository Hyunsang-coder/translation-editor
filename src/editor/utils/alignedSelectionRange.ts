export type SourceAlignmentPrecision = 'selection' | 'sentence' | 'unit';

export interface InitialAlignedSourceRange {
  text: string;
  precision: Exclude<SourceAlignmentPrecision, 'selection'>;
}

interface SentenceSpan {
  start: number;
  end: number;
  text: string;
}

function trimSpan(text: string, start: number, end: number): SentenceSpan | null {
  while (start < end && /\s/u.test(text[start]!)) start += 1;
  while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;
  return end > start ? { start, end, text: text.slice(start, end) } : null;
}

function sentenceSpans(text: string): SentenceSpan[] {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string | string[],
        options?: { granularity: 'sentence' },
      ) => { segment: (input: string) => Iterable<{ segment: string; index: number }> };
    }
  ).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: 'sentence' });
    return [...segmenter.segment(text)].flatMap(({ segment, index }) => {
      const span = trimSpan(text, index, index + segment.length);
      return span ? [span] : [];
    });
  }

  const spans: SentenceSpan[] = [];
  const pattern = /[^.!?。！？]+(?:[.!?。！？]+|$)\s*/gu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const span = trimSpan(text, start, start + match[0].length);
    if (span) spans.push(span);
  }
  return spans;
}

/**
 * 번역 유닛 안에서 신뢰할 수 있는 최소 deterministic 범위를 고른다.
 * 양쪽 문장 수가 같고 Target 선택이 정확히 한 문장에 포함될 때만 같은 순번의 Source
 * 문장으로 좁힌다. 그 외에는 의미를 추측하지 않고 Source 유닛 전체를 돌려준다.
 */
export function resolveInitialAlignedSourceRange(params: {
  sourceUnitText: string;
  targetUnitText: string;
  targetSelectionStart: number;
  targetSelectionEnd: number;
}): InitialAlignedSourceRange {
  const {
    sourceUnitText,
    targetUnitText,
    targetSelectionStart,
    targetSelectionEnd,
  } = params;
  const fallback: InitialAlignedSourceRange = {
    text: sourceUnitText.trim(),
    precision: 'unit',
  };
  if (
    !fallback.text ||
    targetSelectionStart < 0 ||
    targetSelectionEnd <= targetSelectionStart ||
    targetSelectionEnd > targetUnitText.length
  ) return fallback;

  const sourceSentences = sentenceSpans(sourceUnitText);
  const targetSentences = sentenceSpans(targetUnitText);
  if (
    sourceSentences.length === 0 ||
    sourceSentences.length !== targetSentences.length
  ) return fallback;

  const targetIndex = targetSentences.findIndex((sentence) =>
    targetSelectionStart >= sentence.start && targetSelectionEnd <= sentence.end,
  );
  if (targetIndex < 0) return fallback;
  const sourceSentence = sourceSentences[targetIndex];
  return sourceSentence
    ? { text: sourceSentence.text, precision: 'sentence' }
    : fallback;
}
