import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  polishSegments,
  polishSelection,
  retranslateSelection,
  retranslateSegments,
} from './retranslateSelection';

const streamMock = vi.fn();
const createChatModelMock = vi.fn();
const backendStreamMock = vi.fn();
const isTauriRuntimeMock = vi.fn(() => false);

vi.mock('@/tauri/invoke', () => ({
  isTauriRuntime: () => isTauriRuntimeMock(),
}));

vi.mock('@/ai/backendCompletion', () => ({
  streamWithTauriAiBackend: (params: unknown) => backendStreamMock(params),
}));

vi.mock('@/ai/config', () => ({
  getAiConfig: () => ({
    provider: 'openai',
    openaiApiKey: 'test-key',
    model: 'gpt-5-mini',
  }),
}));

vi.mock('@/ai/client', () => ({
  createChatModel: (...args: unknown[]) => {
    createChatModelMock(...args);
    return { stream: streamMock };
  },
}));

describe('retranslateSelection', () => {
  beforeEach(() => {
    streamMock.mockReset();
    backendStreamMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---ALIGNED_SOURCE_SELECTION_START---\nSelected source\n---ALIGNED_SOURCE_SELECTION_END---\n---SELECTION_EDIT_START---\n개선된 번역' };
      yield { content: '\n---SELECTION_EDIT_END---' };
    })());
  });

  it('선택 Source/Target만 보내고 체크되지 않은 컨텍스트는 포함하지 않는다', async () => {
    const result = await retranslateSelection({
      projectId: 'project-1',
      sourceText: 'Selected source',
      currentTargetText: '현재 번역',
      targetLanguage: 'Korean',
      referenceOptions: {
        translationRules: false,
        forbiddenTerms: false,
        glossary: false,
        projectMemory: false,
      },
      contextSnapshot: {
        revision: 3,
        projectMemoryItems: [{ id: 'memory-1', category: 'domain', content: 'SECRET MEMORY' }],
        translationRules: 'SECRET RULE',
        forbiddenTerms: [{ id: 'term-1', term: 'SECRET TERM' }],
        glossaryEntries: [{ id: 'glossary-1', source: 'SECRET', target: '비밀' }],
        createdAt: 1,
      },
    });

    const messages = streamMock.mock.calls[0]?.[0] as Array<{ content: string }>;
    const payload = messages.map((message) => message.content).join('\n');
    expect(payload).toContain('Selected source');
    expect(payload).toContain('현재 번역');
    expect(payload).not.toContain('SECRET MEMORY');
    expect(payload).not.toContain('SECRET RULE');
    expect(payload).not.toContain('SECRET TERM');
    expect(result.replacementText).toBe('개선된 번역');
    expect(result.alignedSourceText).toBe('Selected source');
    expect(result.alignmentPrecision).toBe('selection');
    expect(result.contextManifest.included).toEqual(['selection', 'aligned-source']);
  });

  it('체크된 컨텍스트만 manifest와 프롬프트에 포함한다', async () => {
    const result = await retranslateSelection({
      projectId: 'project-1',
      sourceText: 'Source',
      currentTargetText: 'Target',
      targetLanguage: 'Korean',
      referenceOptions: {
        translationRules: true,
        forbiddenTerms: true,
        glossary: false,
        projectMemory: true,
      },
      contextSnapshot: {
        revision: 4,
        projectMemoryItems: [{ id: 'memory-1', category: 'audience', content: '관리자 대상' }],
        translationRules: '합니다체',
        forbiddenTerms: [{ id: 'term-1', term: '금칙', replacement: '권장' }],
        glossaryEntries: [{ id: 'glossary-1', source: 'Cloud', target: '클라우드' }],
        createdAt: 1,
      },
    });

    const payload = JSON.stringify(streamMock.mock.calls[0]?.[0]);
    expect(payload).toContain('합니다체');
    expect(payload).toContain('금칙');
    expect(payload).toContain('관리자 대상');
    expect(payload).not.toContain('Cloud');
    expect(result.contextManifest.included).toEqual([
      'selection',
      'aligned-source',
      'project-memory',
      'translation-rules',
      'forbidden-terms',
    ]);
    expect(result.contextManifest.projectMemoryItemIds).toEqual(['memory-1']);
    expect(result.contextManifest.forbiddenTermIds).toEqual(['term-1']);
    expect(result.contextManifest.glossaryEntryIds).toEqual([]);
  });

  it('주변 문맥을 delimited 블록으로 보내고 manifest에 기록한다', async () => {
    const result = await retranslateSelection({
      projectId: 'project-1',
      sourceText: 'Selected source',
      currentTargetText: '현재 번역',
      targetLanguage: 'Korean',
      surroundings: {
        sourceBefore: ['Previous source unit'],
        sourceAfter: [],
        targetBefore: ['이전 번역 유닛'],
        targetAfter: ['다음 번역 유닛'],
      },
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
    });

    const messages = streamMock.mock.calls[0]?.[0] as Array<{ content: string }>;
    const user = messages[1]!.content;
    expect(user).toContain('---SURROUNDING_CONTEXT_START---');
    expect(user).toContain('[Source, preceding units]\nPrevious source unit');
    expect(user).toContain('[Target, following units]\n다음 번역 유닛');
    // 내용 없는 방향의 라벨은 넣지 않는다
    expect(user).not.toContain('[Source, following units]');
    expect(result.contextManifest.included).toEqual([
      'selection',
      'aligned-source',
      'surroundings',
    ]);
  });

  it('주변 문맥이 전부 비어 있으면 블록도 manifest 항목도 만들지 않는다', async () => {
    const result = await retranslateSelection({
      projectId: 'project-1',
      sourceText: 'Selected source',
      currentTargetText: '현재 번역',
      targetLanguage: 'Korean',
      surroundings: {
        sourceBefore: [],
        sourceAfter: [],
        targetBefore: ['   '],
        targetAfter: [],
      },
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
    });

    const messages = streamMock.mock.calls[0]?.[0] as Array<{ content: string }>;
    expect(messages[1]!.content).not.toContain('SURROUNDING_CONTEXT');
    expect(result.contextManifest.included).toEqual(['selection', 'aligned-source']);
  });

  it('백엔드 경로에서 cacheSystem을 켠다 (지시사항만 바꿔 재호출해도 system은 캐시)', async () => {
    isTauriRuntimeMock.mockReturnValue(true);
    backendStreamMock.mockResolvedValue(
      '---SELECTION_EDIT_START---\n개선된 번역\n---SELECTION_EDIT_END---',
    );

    await retranslateSelection({
      projectId: 'project-1',
      sourceText: 'Source',
      currentTargetText: 'Target',
      targetLanguage: 'Korean',
      referenceOptions: {
        translationRules: true,
        forbiddenTerms: true,
        glossary: false,
        projectMemory: true,
      },
      contextSnapshot: {
        revision: 4,
        projectMemoryItems: [],
        translationRules: '합니다체',
        forbiddenTerms: [],
        glossaryEntries: [],
        createdAt: 1,
      },
    });

    expect(backendStreamMock.mock.calls[0]?.[0]).toMatchObject({ cacheSystem: true });
  });

  it('전체 Target 유닛과 선택문을 함께 보내 정확한 Source 구절을 식별하게 한다', async () => {
    await retranslateSelection({
      projectId: 'project-1',
      sourceText: 'First source sentence. Exact aligned phrase.',
      suggestedSourceText: 'Exact aligned phrase.',
      suggestedAlignmentPrecision: 'sentence',
      currentTargetUnitText: '첫 번역 문장입니다. 정확한 대응 구절입니다.',
      currentTargetText: '대응 구절',
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
    });

    const payload = JSON.stringify(streamMock.mock.calls[0]?.[0]);
    expect(payload).toContain('First source sentence. Exact aligned phrase.');
    expect(payload).toContain('첫 번역 문장입니다. 정확한 대응 구절입니다.');
    expect(payload).toContain('대응 구절');
  });

  it('모델이 반환한 Source 구절이 원문에 없으면 검증된 초기 범위로 폴백한다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---ALIGNED_SOURCE_SELECTION_START---\nHALLUCINATED SOURCE\n---ALIGNED_SOURCE_SELECTION_END---\n' };
      yield { content: '---SELECTION_EDIT_START---\n개선된 번역\n---SELECTION_EDIT_END---' };
    })());

    const result = await retranslateSelection({
      projectId: 'project-1',
      sourceText: 'First source sentence. Exact aligned phrase.',
      suggestedSourceText: 'Exact aligned phrase.',
      suggestedAlignmentPrecision: 'sentence',
      currentTargetUnitText: '전체 번역문',
      currentTargetText: '선택 번역문',
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
    });

    expect(result.alignedSourceText).toBe('Exact aligned phrase.');
    expect(result.alignmentPrecision).toBe('sentence');
  });
});

describe('retranslateSegments', () => {
  const BASE = {
    projectId: 'project-1',
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

  const TWO_CELLS = [
    { sourceText: 'Alpha source', currentTargetText: '알파 번역' },
    { sourceText: 'Beta source', currentTargetText: '베타 번역' },
  ];

  beforeEach(() => {
    streamMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
  });

  it('블록 마커를 블록마다 잘라 한 번의 호출로 돌려준다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\n알파 개선\n---SEGMENT_0_END---\n' };
      yield { content: '---SEGMENT_1_START---\n베타 개선\n---SEGMENT_1_END---' };
    })());

    const result = await retranslateSegments({ ...BASE, segments: TWO_CELLS });

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(result.replacements).toEqual(['알파 개선', '베타 개선']);
    const payload = JSON.stringify(streamMock.mock.calls[0]?.[0]);
    expect(payload).toContain('Alpha source');
    expect(payload).toContain('베타 번역');
  });

  it('블록 하나라도 마커가 없으면 던진다 (부분 적용 금지)', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\n알파 개선\n---SEGMENT_0_END---' };
    })());

    await expect(retranslateSegments({ ...BASE, segments: TWO_CELLS }))
      .rejects.toThrow(/2번째 블록 누락/);
  });

  it('END 마커가 잘린 응답도 던진다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\n알파 개선\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n베타' };
    })());

    await expect(retranslateSegments({ ...BASE, segments: TWO_CELLS }))
      .rejects.toThrow(/올바르지 않습니다/);
  });

  it('체크되지 않은 컨텍스트는 페이로드에 넣지 않는다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\nX\n---SEGMENT_0_END---\n---SEGMENT_1_START---\nY\n---SEGMENT_1_END---' };
    })());

    await retranslateSegments({
      ...BASE,
      segments: TWO_CELLS,
      contextSnapshot: {
        ...BASE.contextSnapshot,
        translationRules: 'SECRET RULE',
        glossaryEntries: [{ id: 'g1', source: 'SECRET', target: '비밀' }],
      },
    });

    const payload = JSON.stringify(streamMock.mock.calls[0]?.[0]);
    expect(payload).not.toContain('SECRET RULE');
    expect(payload).not.toContain('비밀');
  });

  it('현재 번역문이 빈 블록이 있으면 호출 전에 던진다', async () => {
    await expect(retranslateSegments({
      ...BASE,
      segments: [{ sourceText: '  ', currentTargetText: '' }],
    })).rejects.toThrow(/현재 번역문/);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('스트리밍 중에는 아직 안 온 블록을 빈 문자열로 알린다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\n알파 개선\n---SEGMENT_0_END---\n' };
      yield { content: '---SEGMENT_1_START---\n베타 개선\n---SEGMENT_1_END---' };
    })());
    const snapshots: string[][] = [];

    await retranslateSegments({
      ...BASE,
      segments: TWO_CELLS,
      onToken: (replacements: string[]) => snapshots.push(replacements),
    });

    expect(snapshots[0]).toEqual(['알파 개선', '']);
    expect(snapshots[1]).toEqual(['알파 개선', '베타 개선']);
  });
});

describe('표 열 헤더 문맥', () => {
  const BASE = {
    projectId: 'project-1',
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

  beforeEach(() => {
    streamMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
  });

  it('단일 선택 재번역 페이로드에 열 헤더가 들어간다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SELECTION_EDIT_START---\n피해량\n---SELECTION_EDIT_END---' };
    })());

    await retranslateSelection({
      ...BASE,
      sourceText: 'Damage',
      currentTargetText: '손상',
      columnHeader: { source: 'Stat', target: '스탯' },
    });

    const payload = JSON.stringify(streamMock.mock.calls[0]?.[0]);
    expect(payload).toContain('Table column header');
    expect(payload).toContain('Stat / 스탯');
  });

  it('열 헤더가 없으면 user 블록에 넣지 않는다 (system 지시문은 캐시를 위해 상시 유지)', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SELECTION_EDIT_START---\n피해량\n---SELECTION_EDIT_END---' };
    })());

    await retranslateSelection({ ...BASE, sourceText: 'Damage', currentTargetText: '손상' });

    const messages = streamMock.mock.calls[0]?.[0] as Array<{ content: string }>;
    expect(messages[1]!.content).not.toContain('Table column header');
    // system은 호출마다 같아야 Anthropic 프롬프트 캐시(cacheSystem)가 산다
    expect(messages[0]!.content).toContain('A table column header, when provided');
  });

  it('여러 블록은 블록마다 자기 열 헤더를 받는다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\nA\n---SEGMENT_0_END---\n---SEGMENT_1_START---\nB\n---SEGMENT_1_END---' };
    })());

    await retranslateSegments({
      ...BASE,
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
    });

    const payload = JSON.stringify(streamMock.mock.calls[0]?.[0]);
    expect(payload).toContain('Stat / 스탯');
    expect(payload).toContain('Description / 설명');
    // 헤더는 셀 입력 블록 안에 붙는다
    expect(payload).toMatch(/SEGMENT_0_INPUT_START---\\n\[Column header\] Stat/);
  });

  it('원문 짝을 못 찾은 헤더는 번역문만 보낸다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\nA\n---SEGMENT_0_END---' };
    })());

    await retranslateSegments({
      ...BASE,
      segments: [
        { sourceText: 'Damage', currentTargetText: '손상', columnHeader: { target: '스탯' } },
      ],
    });

    expect(JSON.stringify(streamMock.mock.calls[0]?.[0])).toContain('[Column header] 스탯');
  });
});

describe('원문 짝 없는 블록', () => {
  const BASE = {
    projectId: 'project-1',
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

  beforeEach(() => {
    streamMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\nA\n---SEGMENT_0_END---\n---SEGMENT_1_START---\nB\n---SEGMENT_1_END---' };
    })());
  });

  it('원문 없는 블록은 [No source]로 표시하고 원문 블록은 넣지 않는다', async () => {
    await retranslateSegments({
      ...BASE,
      segments: [
        { sourceText: 'Aligned source', currentTargetText: '기존 번역 1' },
        { currentTargetText: '기존 번역 2' },
      ],
    });

    const messages = streamMock.mock.calls[0]?.[0] as Array<{ content: string }>;
    const user = messages[1]!.content;
    expect(user).toContain('[Source]\nAligned source');
    expect(user).toContain('[No source] Improve the existing target only.');
    // 원문 없는 블록에는 [Source] 라벨이 붙지 않는다
    expect(user.split('---SEGMENT_1_INPUT_START---')[1]).not.toContain('[Source]');
    // system에 그 모드의 규칙이 있다
    expect(messages[0]!.content).toContain('A block marked [No source]');
  });

  it('공백뿐인 sourceText도 원문 없음으로 다룬다', async () => {
    await retranslateSegments({
      ...BASE,
      segments: [
        { sourceText: '   ', currentTargetText: '기존 1' },
        { sourceText: 'Real', currentTargetText: '기존 2' },
      ],
    });

    const user = (streamMock.mock.calls[0]?.[0] as Array<{ content: string }>)[1]!.content;
    expect(user.split('---SEGMENT_1_INPUT_START---')[0]).toContain('[No source]');
  });
});

describe('polishSelection', () => {
  const BASE = {
    projectId: 'project-1',
    currentTargetText: '현재 번역',
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

  beforeEach(() => {
    streamMock.mockReset();
    createChatModelMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SELECTION_EDIT_START---\n다듬은 번역\n---SELECTION_EDIT_END---' };
    })());
  });

  it('원문 없이도 실행하고 manifest에 aligned-source를 넣지 않는다', async () => {
    const result = await polishSelection({ ...BASE });

    const messages = streamMock.mock.calls[0]?.[0] as Array<{ content: string }>;
    expect(messages[0]!.content).toContain('Polish only the selected Target text');
    expect(messages[1]!.content).toContain('[No source] Improve the existing target only.');
    expect(result.replacementText).toBe('다듬은 번역');
    expect(result.contextManifest.included).toEqual(['selection']);
    expect(result.contextManifest.mode).toBe('selection-polish');
  });

  it('원문이 있으면 참조로 넣고 aligned-source를 기록한다', async () => {
    const result = await polishSelection({ ...BASE, sourceText: 'Aligned source' });

    const user = (streamMock.mock.calls[0]?.[0] as Array<{ content: string }>)[1]!.content;
    expect(user).toContain('Aligned source');
    expect(result.contextManifest.included).toEqual(['selection', 'aligned-source']);
  });

  it('재번역과 달리 정렬 원문 마커를 요구하지 않는다', async () => {
    await polishSelection({ ...BASE });

    const system = (streamMock.mock.calls[0]?.[0] as Array<{ content: string }>)[0]!.content;
    expect(system).not.toContain('ALIGNED_SOURCE_SELECTION_START');
  });

  it('문서 전체 폴리싱과 같은 용도(polish)의 모델을 쓴다', async () => {
    await polishSelection({ ...BASE });

    expect(createChatModelMock.mock.calls[0]?.[1]).toMatchObject({ useFor: 'polish' });
  });

  it('체크된 컨텍스트만 프롬프트에 넣는다 (재번역과 같은 기준)', async () => {
    const result = await polishSelection({
      ...BASE,
      referenceOptions: {
        translationRules: true,
        forbiddenTerms: false,
        glossary: false,
        projectMemory: false,
      },
      contextSnapshot: {
        ...BASE.contextSnapshot,
        translationRules: 'RULE ONE',
        glossaryEntries: [{ id: 'glossary-1', source: 'SECRET', target: '비밀' }],
      },
    });

    const payload = (streamMock.mock.calls[0]?.[0] as Array<{ content: string }>)
      .map((message) => message.content)
      .join('\n');
    expect(payload).toContain('RULE ONE');
    expect(payload).not.toContain('SECRET');
    expect(result.contextManifest.included).toContain('translation-rules');
  });

  it('마커가 없으면 폴리싱 형식 오류로 던진다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '그냥 텍스트' };
    })());

    await expect(polishSelection({ ...BASE })).rejects.toThrow('선택 영역 폴리싱');
  });
});

describe('polishSegments', () => {
  const BASE = {
    projectId: 'project-1',
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

  beforeEach(() => {
    streamMock.mockReset();
    createChatModelMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\n다듬음 1\n---SEGMENT_0_END---\n---SEGMENT_1_START---\n다듬음 2\n---SEGMENT_1_END---' };
    })());
  });

  it('블록마다 결과를 잘라 내고 폴리싱 지시를 쓴다', async () => {
    const result = await polishSegments({
      ...BASE,
      segments: [
        { sourceText: 'Aligned', currentTargetText: '기존 1' },
        { currentTargetText: '기존 2' },
      ],
    });

    expect(result.replacements).toEqual(['다듬음 1', '다듬음 2']);
    const system = (streamMock.mock.calls[0]?.[0] as Array<{ content: string }>)[0]!.content;
    expect(system).toContain('Polish each selected block');
    expect(system).not.toContain('Retranslate each selected block');
  });

  it('블록이 하나라도 비면 전부 버린다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\n다듬음 1\n---SEGMENT_0_END---' };
    })());

    await expect(polishSegments({
      ...BASE,
      segments: [
        { currentTargetText: '기존 1' },
        { currentTargetText: '기존 2' },
      ],
    })).rejects.toThrow('부분 폴리싱');
  });
});

describe('재번역/폴리싱이 현재 번역문을 대하는 태도', () => {
  const BASE = {
    projectId: 'project-1',
    currentTargetText: '현재 번역',
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

  beforeEach(() => {
    streamMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
  });

  it('재번역은 기존 번역문을 초안으로 삼지 말라고 지시한다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SELECTION_EDIT_START---\n새 번역\n---SELECTION_EDIT_END---' };
    })());

    await retranslateSelection({ ...BASE, sourceText: 'Source sentence' });

    const system = (streamMock.mock.calls[0]?.[0] as Array<{ content: string }>)[0]!.content;
    expect(system).toContain('Translate the Source afresh');
    expect(system).toContain('not a draft to edit');
    // 기존의 "editing reference" 표현은 최소 수정을 유도해서 걷어냈다
    expect(system).not.toContain('editing reference');
  });

  it('폴리싱은 반대로 기존 의미를 그대로 지키라고 지시한다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SELECTION_EDIT_START---\n다듬은 번역\n---SELECTION_EDIT_END---' };
    })());

    await polishSelection({ ...BASE });

    const system = (streamMock.mock.calls[0]?.[0] as Array<{ content: string }>)[0]!.content;
    expect(system).toContain('Preserve the existing meaning exactly');
    expect(system).not.toContain('Translate the Source afresh');
    // 폴리싱의 주 목표는 어휘 치환이 아니라 문장 구조 교정이다
    expect(system).toContain('Sentence structure is the main job');
    expect(system).toContain('split or combine sentences');
    // 원문이 들어가 있어도 오역 교정은 재번역·검수의 몫이다
    expect(system).toContain('Even when the Source plainly contradicts the current Target');
    expect(system).toContain('never use it to correct the Target');
  });

  it('여러 블록 재번역도 같은 기준을 쓰되 [No source] 블록만 예외로 둔다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\nA\n---SEGMENT_0_END---' };
    })());

    await retranslateSegments({
      ...BASE,
      segments: [{ sourceText: 'Source', currentTargetText: '기존' }],
    });

    const system = (streamMock.mock.calls[0]?.[0] as Array<{ content: string }>)[0]!.content;
    expect(system).toContain('Translate each [Source] afresh');
    expect(system).toContain('[No source] is the one exception');
  });
});
