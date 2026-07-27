import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retranslateSelection } from './retranslateSelection';

const streamMock = vi.fn();

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
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SELECTION_EDIT_START---\n개선된 번역' };
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
});
