import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retranslateSelection } from './retranslateSelection';

const streamMock = vi.fn();
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
  createChatModel: () => ({
    stream: streamMock,
  }),
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
        projectContext: false,
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
        projectContext: true,
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
        projectContext: true,
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
        projectContext: false,
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
        projectContext: false,
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
