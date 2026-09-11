import { beforeEach, describe, expect, it, vi } from 'vitest';
import { polishSegments } from './retranslateSelection';
import type { RetranslateSegmentsInput } from './retranslateSelection';

/**
 * 부분 폴리싱 마커 깨짐 재현 케이스.
 *
 * 실제 LLM을 부르지 않고 `createChatModel().stream`을 목으로 갈아끼워
 * 모델이 자주 내놓는 깨진 모양 5가지를 그대로 흘려보낸다.
 * 지금 파서(엄격 모드)가 전부 throw하는 것을 고정한다 — 즉 이 테스트들은
 * "왜 종종 터지는가"의 증거용이지, 관대 파서 구현 후에는 반대로 고쳐야 한다.
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

describe('부분 폴리싱 마커 깨짐 재현', () => {
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

  it('원인1 — 프롬프트에 no block labels와 마커 지시가 공존한다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_START---\na\n---SEGMENT_0_END---\n---SEGMENT_1_START---\nb\n---SEGMENT_1_END---',
    );
    await polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] });
    const system = systemOf();
    // 이 두 줄이 동시에 있으면 모델이 마커를 block label로 보고 생략할 수 있다.
    expect(system).toContain('no block labels');
    expect(system).toContain('---SEGMENT_<i>_START---');
  });

  it('원인2 — 마지막 END 전 잘림(토큰 예산 공유)은 N번째 누락으로 터진다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_START---\n첫 번째 다듬음.\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n두 번째 다듬음.',
    );
    await expect(
      polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] }),
    ).rejects.toThrow('2번째 블록 누락');
  });

  it('원인3a — 마커 통째로 생략(plain text만 반환)', async () => {
    mockStreamWhole('첫 번째 다듬음.\n\n두 번째 다듬음.');
    await expect(
      polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] }),
    ).rejects.toThrow('1번째 블록 누락');
  });

  it('원인3b — 1-based 번호 매김', async () => {
    mockStreamWhole(
      '---SEGMENT_1_START---\n첫 번째 다듬음.\n---SEGMENT_1_END---\n---SEGMENT_2_START---\n두 번째 다듬음.\n---SEGMENT_2_END---',
    );
    await expect(
      polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] }),
    ).rejects.toThrow('1번째 블록 누락');
  });

  it('원인3c — INPUT 마커 에코(출력 마커와 혼동)', async () => {
    mockStreamWhole(
      '---SEGMENT_0_INPUT_START---\n첫 번째 다듬음.\n---SEGMENT_0_INPUT_END---\n---SEGMENT_1_INPUT_START---\n두 번째 다듬음.\n---SEGMENT_1_INPUT_END---',
    );
    await expect(
      polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] }),
    ).rejects.toThrow('1번째 블록 누락');
  });

  it('원인4 — 빈 블록(unchanged인데 비워둠)은 전체를 버린다', async () => {
    mockStreamWhole(
      '---SEGMENT_0_START---\n첫 번째 다듬음.\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n\n---SEGMENT_1_END---',
    );
    await expect(
      polishSegments({ ...BASE_INPUT, segments: [...BASE_INPUT.segments] }),
    ).rejects.toThrow('2번째 블록 누락');
  });
});

describe('표 셀 깨짐 재현', () => {
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

  it('표 고유1 — 두 셀을 한 블록으로 합치면 뒷 블록 누락으로 터진다', async () => {
    mockStreamWhole('---SEGMENT_0_START---\n피해량. 받는 피해 감소.\n---SEGMENT_0_END---');
    await expect(polishSegments(TABLE_INPUT)).rejects.toThrow('2번째 블록 누락');
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
