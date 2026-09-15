import { beforeEach, describe, expect, it, vi } from 'vitest';
import { polishSegments } from './retranslateSelection';
import type { RetranslateSegmentsInput } from './retranslateSelection';

/**
 * 부분 폴리싱 마커 관대 파싱 계약.
 *
 * 엄격 모드(하나라도 어긋나면 전체 throw)에서는 아래 변형이 전부
 * "N번째 블록 누락"으로 터졌다. 관대 파서부터는 계약이 바뀐다:
 * - 읽힌 블록은 적용하고, 못 읽은 블록만 그 블록의 원문으로 유지한다.
 *   모달이 원문과 같은 제안을 "변경 없음"으로 보여주는 기존 경로와 같은 값이다.
 * - 마커가 하나도 없는 응답만 던진다(프로토콜 이탈). 이때는 응답 앞부분을
 *   에러에 실어 다음 실패를 바로 판별할 수 있게 한다.
 * Preview-First(ADR-0003)라 fallback이 문서에 바로 들어가지 않는다.
 */

const streamMock = vi.fn();

vi.mock('@/tauri/invoke', () => ({
  isTauriRuntime: () => false,
}));

vi.mock('@/ai/backendCompletion', () => ({
  streamWithTauriAiBackend: vi.fn(),
}));

vi.mock('@/ai/config', () => ({
  getAiConfig: () => ({
    provider: 'openai',
    openaiApiKey: 'test-key',
    model: 'gpt-5-mini',
  }),
}));

vi.mock('@/ai/client', () => ({
  createChatModel: () => ({ stream: streamMock }),
}));

const BASE_INPUT: RetranslateSegmentsInput = {
  projectId: 'repro',
  segments: [
    { currentTargetText: '첫 번째 문단입니다.' },
    { currentTargetText: '두 번째 문단입니다.' },
  ],
  targetLanguage: 'Korean',
  referenceOptions: {
    translationRules: false,
    forbiddenTerms: false,
    glossary: false,
    projectMemory: false,
  },
  contextSnapshot: {
    revision: 1,
    projectMemoryItems: [],
    translationRules: '',
    forbiddenTerms: [],
    glossaryEntries: [],
    createdAt: 1,
  },
};

function mockStreamWhole(raw: string): void {
  streamMock.mockResolvedValue((async function* () {
    yield { content: raw };
  })());
}

function systemOf(): string {
  const messages = streamMock.mock.calls[0]?.[0] as Array<{ content: string }>;
  return messages.find((m) => m.content.includes('SEGMENT'))?.content ?? '';
}

describe('부분 폴리싱 마커 관대 파싱', () => {
  beforeEach(() => {
    streamMock.mockReset();
  });

  it('대조군 — 정상 마커는 통과한다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_START---\n첫 번째 다듬음.\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n두 번째 다듬음.\n---SEGMENT_1_END---',
    );
    const result = await polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] });
    expect(result.replacements).toEqual(['첫 번째 다듬음.', '두 번째 다듬음.']);
  });

  it('프롬프트는 세그먼트 마커가 label 금지의 예외임을 명시한다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_START---\na\n---SEGMENT_0_END---\n---SEGMENT_1_START---\nb\n---SEGMENT_1_END---',
    );
    await polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] });
    const system = systemOf();
    expect(system).toContain('required scaffolding, not labels');
    expect(system).not.toContain('no block labels');
  });

  it('마지막 END 전 잘림은 잘린 블록만 원문 유지한다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_START---\n첫 번째 다듬음.\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n두 번째 다듬음.',
    );
    const result = await polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] });
    expect(result.replacements).toEqual(['첫 번째 다듬음.', '두 번째 문단입니다.']);
  });

  it('마커 통째로 생략은 응답 앞부분을 담은 에러를 던진다', async () => {
    mockStreamWhole('첫 번째 다듬음.\n\n두 번째 다듬음.');
    let error: Error | null = null;
    try {
      await polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] });
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toContain('부분 폴리싱');
    expect(error?.message).toContain('첫 번째 다듬음.');
  });

  it('1-based 번호 매김을 받아들인다', async () => {
    mockStreamWhole(
      '---SEGMENT_1_START---\n첫 번째 다듬음.\n---SEGMENT_1_END---\n---SEGMENT_2_START---\n두 번째 다듬음.\n---SEGMENT_2_END---',
    );
    const result = await polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] });
    expect(result.replacements).toEqual(['첫 번째 다듬음.', '두 번째 다듬음.']);
  });

  it('INPUT 마커 에코를 받아들인다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_INPUT_START---\n첫 번째 다듬음.\n---SEGMENT_0_INPUT_END---\n---SEGMENT_1_INPUT_START---\n두 번째 다듬음.\n---SEGMENT_1_INPUT_END---',
    );
    const result = await polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] });
    expect(result.replacements).toEqual(['첫 번째 다듬음.', '두 번째 다듬음.']);
  });

  it('빈 블록(unchanged인데 비워둠)은 그 블록만 원문 유지한다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_START---\n첫 번째 다듬음.\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n\n---SEGMENT_1_END---',
    );
    const result = await polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] });
    expect(result.replacements).toEqual(['첫 번째 다듬음.', '두 번째 문단입니다.']);
  });
});

describe('표 셀 관대 파싱', () => {
  const TABLE_INPUT = {
    ...BASE_INPUT,
    segments: [
      {
        sourceText: 'Damage',
        currentTargetText: '손상',
        columnHeader: { source: 'Stat', target: '스탯' },
      },
      {
        sourceText: 'Reduces incoming hits',
        currentTargetText: '들어오는 타격 감소',
        columnHeader: { source: 'Description', target: '설명' },
      },
    ],
  } as RetranslateSegmentsInput;

  beforeEach(() => {
    streamMock.mockReset();
  });

  it('대조군 — 셀마다 자기 헤더로 다듬으면 통과한다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_START---\n피해량\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n받는 피해 감소\n---SEGMENT_1_END---',
    );
    const result = await polishSegments(TABLE_INPUT);
    expect(result.replacements).toEqual(['피해량', '받는 피해 감소']);
  });

  it('두 셀을 한 블록으로 합치면 못 읽은 셀만 원문 유지한다', async () => {
    mockStreamWhole('---SEGMENT_0_START---\n피해량. 받는 피해 감소.\n---SEGMENT_0_END---');
    const result = await polishSegments(TABLE_INPUT);
    // 합쳐진 0번은 프리뷰에서 사람이 걸러낸다(Preview-First). 1번은 날조 대신 원문.
    expect(result.replacements).toEqual(['피해량. 받는 피해 감소.', '들어오는 타격 감소']);
  });

  it('표 고유2 — 마크다운 표 구문 에코는 파서를 통과한다(품질 구멍)', async () => {
    // "no table syntax" 지시 위반이지만 마커는 멀쩡해서 파서는 못 잡는다.
    // 셀이 `| 피해량 |` 통째로 들어가면 적용 단계에서 깨진다.
    mockStreamWhole(
      '---SEGMENT_0_START---\n| 피해량 |\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n받는 피해 감소\n---SEGMENT_1_END---',
    );
    const result = await polishSegments(TABLE_INPUT);
    expect(result.replacements[0]).toContain('|');
  });

  it('표 고유3 — 열 헤더 베끼기는 파서를 통과한다(품질 구멍)', async () => {
    // "Never copy it into the replacement" 위반이지만 마커는 멀쩡해서 파서는 못 잡는다.
    mockStreamWhole(
      '---SEGMENT_0_START---\n스탯: 피해량\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n받는 피해 감소\n---SEGMENT_1_END---',
    );
    const result = await polishSegments(TABLE_INPUT);
    expect(result.replacements[0]).toContain('스탯');
  });
});
