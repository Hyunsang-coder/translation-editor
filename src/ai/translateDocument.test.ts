import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ITEProject, ResolvedWorkflowContext } from '@/types';
import type { ReviewIssue } from '@/stores/reviewStore';
import { isValidTipTapDocJson, type TipTapDocJson } from '@/utils/markdownConverter';
import {
  isTimeoutError,
  isRetryableTranslationError,
  formatTranslationError,
  translateWithStreaming,
  translateSourceDocWithChunking,
} from '@/ai/translateDocument';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { KNOWLEDGE_DIRECTIVES } from '@/ai/context/projectKnowledgeRender';
import {
  createMockChatModel,
  createMockAiConfig,
  MOCK_TRANSLATION_RESPONSE,
} from '@/test/mocks/ai';

// AI 설정 모킹
vi.mock('@/ai/config', () => ({
  getAiConfig: vi.fn(() => createMockAiConfig()),
}));

// LangChain 모킹
vi.mock('@/ai/client', () => ({
  createChatModel: vi.fn(() => createMockChatModel(MOCK_TRANSLATION_RESPONSE)),
}));

/**
 * Phase 5: 번역 실행 테스트
 * 사용자 스토리: 마리아가 "Translate" 버튼을 클릭하고 번역 결과를 받음
 */

describe('translateDocument - 번역 엔드투엔드 (Phase 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAiConfig).mockReturnValue(createMockAiConfig());
    vi.mocked(createChatModel).mockImplementation(
      () => createMockChatModel(MOCK_TRANSLATION_RESPONSE) as never,
    );
  });

  const mockProject: ITEProject = {
    id: 'project-translation-test',
    version: '1.0.0',
    metadata: {
      title: 'Translation Test Project',
      domain: 'general',
      targetLanguage: 'English',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        strictnessLevel: 0.5,
        autoSave: true,
        autoSaveInterval: 30_000,
        theme: 'system',
      },
    },
    segments: [],
    blocks: {},
  };

  const sourceDocJson: TipTapDocJson = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Guía de Integración de API',
          },
        ],
      },
    ],
  };

  const resolvedContext: ResolvedWorkflowContext = {
    snapshot: {
      revision: 7,
      projectMemoryItems: [{ id: 'memory-1', category: 'audience', content: 'Enterprise admins' }],
      translationRules: 'Use a formal tone.',
      forbiddenTerms: [{ id: 'forbidden-1', term: 'simply', replacement: 'directly' }],
      glossaryEntries: [{ id: 'glossary-1', source: 'workspace', target: 'workspace' }],
      createdAt: 1,
    },
    manifest: {
      mode: 'full-translate',
      revision: 7,
      projectMemoryItemIds: ['memory-1'],
      translationRulesHash: 'rules-hash',
      forbiddenTermIds: ['forbidden-1'],
      glossaryEntryIds: ['glossary-1'],
      included: ['project-memory', 'translation-rules', 'forbidden-terms', 'glossary'],
    },
    rendered: {
      projectMemory: '- [audience] Enterprise admins',
      translationRules: 'Use a formal tone.',
      forbiddenTerms: '- simply → directly',
      glossary: 'workspace = workspace',
    },
  };

  // ===== 유틸리티 함수 테스트 (기본) =====

  describe('isTimeoutError', () => {
    it('timeout 문자열을 포함하면 true', () => {
      const error = new Error('Request timeout after 30s');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('timed out 문자열을 포함하면 true', () => {
      const error = new Error('Connection timed out');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('socket hang up을 포함하면 true', () => {
      const error = new Error('socket hang up');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('aborted 문자열을 포함하면 true', () => {
      const error = new Error('Request aborted');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('timeout 관련 문자가 없으면 false', () => {
      const error = new Error('Invalid API key');
      expect(isTimeoutError(error)).toBe(false);
    });

    it('Error가 아닌 값은 false', () => {
      expect(isTimeoutError('error')).toBe(false);
      expect(isTimeoutError(null)).toBe(false);
    });
  });

  describe('isRetryableTranslationError', () => {
    it('파싱 에러는 재시도 가능', () => {
      const error = new Error('JSON 파싱 실패');
      expect(isRetryableTranslationError(error)).toBe(true);
    });

    it('truncation 에러는 재시도 가능', () => {
      const error = new Error('응답이 truncated되었습니다');
      expect(isRetryableTranslationError(error)).toBe(true);
    });

    it('timeout 에러는 재시도 가능', () => {
      const error = new Error('Request timeout');
      expect(isRetryableTranslationError(error)).toBe(true);
    });

    it('네트워크 에러는 재시도 가능', () => {
      const error = new Error('network error');
      expect(isRetryableTranslationError(error)).toBe(true);
    });

    it('API 키 에러는 재시도 불가', () => {
      const error = new Error('Invalid API key');
      expect(isRetryableTranslationError(error)).toBe(false);
    });
  });

  describe('formatTranslationError', () => {
    it('타임아웃 에러를 사용자 친화적 메시지로 변환', () => {
      const error = new Error('Request timeout after 30s');
      const message = formatTranslationError(error);
      expect(message).toContain('초과');
      expect(message).toContain('다시 시도');
    });

    it('파싱 에러를 사용자 친화적 메시지로 변환', () => {
      const error = new Error('JSON 파싱 실패');
      const message = formatTranslationError(error);
      expect(message).toContain('처리');
      expect(message).toContain('다시 시도');
    });

    it('빈 응답 에러를 사용자 친화적 메시지로 변환', () => {
      const error = new Error('응답이 비어있습니다');
      const message = formatTranslationError(error);
      expect(message).toContain('비어');
    });

    it('Truncation 에러를 사용자 친화적 메시지로 변환', () => {
      const error = new Error('응답이 truncated');
      const message = formatTranslationError(error);
      expect(message).toContain('잘렸');
    });

    it('Error가 아닌 값도 문자열로 변환', () => {
      const message = formatTranslationError('Custom error message');
      expect(message).toBe('Custom error message');
    });
  });

  // ===== 번역 통합 테스트 (아직 구현 미완료) =====

  describe('translateWithStreaming - 번역 실행 (Phase 5.1)', () => {
    it('Spanish → English 번역 성공', async () => {
      const onToken = vi.fn();

      const result = await translateWithStreaming({
        project: mockProject,
        sourceDocJson,
        onToken,
      });

      expect(result.doc.type).toBe('doc');
      expect(result.raw).toContain('---TRANSLATION_START---');
      expect(onToken).toHaveBeenCalled();
      expect(vi.mocked(createChatModel)).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ useFor: 'translation' }),
      );
    });

    it('고정된 컨텍스트 스냅샷을 legacy 문자열보다 우선한다', async () => {
      const model = createMockChatModel(MOCK_TRANSLATION_RESPONSE);
      vi.mocked(createChatModel).mockReturnValue(model as never);

      await translateWithStreaming({
        project: mockProject,
        sourceDocJson,
        resolvedContext,
        translationRules: 'legacy rule',
        projectContext: 'legacy context',
        glossary: 'legacy glossary',
      });

      const [messages] = model.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      const systemPrompt = String(messages[0]?.content);
      expect(systemPrompt).toContain('Enterprise admins');
      expect(systemPrompt).toContain('Use a formal tone.');
      expect(systemPrompt).toContain('- simply → directly');
      expect(systemPrompt).toContain('workspace = workspace');
      expect(systemPrompt).not.toContain('legacy rule');
      expect(systemPrompt).not.toContain('legacy context');
      expect(systemPrompt).not.toContain('legacy glossary');
    });

    it('주입된 지식 섹션마다 사용 지시문이 붙는다', async () => {
      const model = createMockChatModel(MOCK_TRANSLATION_RESPONSE);
      vi.mocked(createChatModel).mockReturnValue(model as never);

      await translateWithStreaming({ project: mockProject, sourceDocJson, resolvedContext });

      const [messages] = model.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      const systemPrompt = String(messages[0]?.content);
      for (const directive of Object.values(KNOWLEDGE_DIRECTIVES)) {
        expect(systemPrompt).toContain(directive);
      }
    });

    it('번역 중 취소 (AbortSignal)', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const model = createMockChatModel(MOCK_TRANSLATION_RESPONSE);
      vi.mocked(createChatModel).mockReturnValue(model as never);

      await expect(
        translateWithStreaming({
          project: mockProject,
          sourceDocJson,
          abortSignal: abortController.signal,
        }),
      ).rejects.toThrow('번역이 취소되었습니다.');

      expect(model.stream).not.toHaveBeenCalled();
    });

    it('대용량 문서는 청킹 경로로 분할 번역 가능', async () => {
      const largeDoc: TipTapDocJson = {
        type: 'doc',
        content: Array.from({ length: 180 }, (_, index) => ({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: `Section ${index}: ${'Este documento tecnico incluye multiples reglas y contexto detallado. '.repeat(20)}`,
            },
          ],
        })),
      };
      const onProgress = vi.fn();

      const result = await translateSourceDocWithChunking({
        project: mockProject,
        sourceDocJson: largeDoc,
        onProgress,
      });

      expect(result.wasChunked).toBe(true);
      expect(result.totalChunks).toBeGreaterThan(1);
      expect(result.successfulChunks).toBe(result.totalChunks);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'translating' }),
      );
      expect(vi.mocked(createChatModel).mock.calls.length).toBeGreaterThan(1);
    });

    it('API 오류 시 에러 메시지 반환', async () => {
      const { openaiApiKey: _, ...configWithoutKey } = createMockAiConfig();
      vi.mocked(getAiConfig).mockReturnValue(configWithoutKey);

      await expect(
        translateWithStreaming({
          project: mockProject,
          sourceDocJson,
        }),
      ).rejects.toThrow();

      expect(vi.mocked(createChatModel)).not.toHaveBeenCalled();
    });
  });

  describe('번역 결과 - Preview Modal (Phase 5.2)', () => {
    it('번역 결과가 TipTap JSON으로 반환됨', async () => {
      const onToken = vi.fn();

      const result = await translateWithStreaming({
        project: mockProject,
        sourceDocJson,
        onToken,
      });

      expect(isValidTipTapDocJson(result.doc)).toBe(true);
      expect(result.doc.type).toBe('doc');

      const calls = onToken.mock.calls;
      const lastStreamText = String(calls[calls.length - 1]?.[0] ?? '');
      expect(lastStreamText).toContain('API Integration Guide');
      expect(lastStreamText).not.toContain('---TRANSLATION_START---');
      expect(lastStreamText).not.toContain('---TRANSLATION_END---');
    });

    it('이미지 노드는 번역 프롬프트에서 제거됨', async () => {
      const docWithImage: TipTapDocJson = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Texto antes de la imagen' }],
          },
          {
            type: 'image',
            attrs: {
              src: 'https://example.com/cat.png',
              alt: 'cat',
            },
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Texto despues de la imagen' }],
          },
        ],
      };

      const model = createMockChatModel(MOCK_TRANSLATION_RESPONSE);
      vi.mocked(createChatModel).mockReturnValue(model as never);

      await translateWithStreaming({
        project: mockProject,
        sourceDocJson: docWithImage,
      });

      const [messages] = model.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      const userPrompt = String(messages[1]?.content ?? '');
      expect(userPrompt).toContain('Texto antes de la imagen');
      expect(userPrompt).toContain('Texto despues de la imagen');
      expect(userPrompt).not.toContain('![');
      expect(userPrompt).not.toContain('https://example.com/cat.png');
    });

    it.skip('Diff 뷰에서 변경 부분 강조', () => {
      // TODO: TranslatePreviewModal에서 검증
      // Diff 알고리즘으로 변경 부분 표시
    });
  });

  describe('번역 적용 (Phase 5.2 - Apply)', () => {
    it.skip('Apply 클릭 후 Target 에디터 업데이트', async () => {
      // Arrange: 번역 결과를 받은 상태
      // const translatedDoc = await getTranslationResult();

      // Act: Apply 클릭
      // useProjectStore.getState().setTargetDocument(
      //   tipTapJsonToHtml(translatedDoc)
      // );

      // Assert: Target 에디터 콘텐츠 확인
      // const targetContent = useProjectStore.getState().targetDocument;
      // expect(targetContent).toContain('API Integration Guide');
    });

    it.skip('Undo 가능 (이전 Target 상태 복원)', async () => {
      // Assert: 이전 상태로 복원 가능
    });

    it.skip('자동 저장 (Apply 후 SQLite 저장)', async () => {
      // Assert: 번역 결과가 DB에 저장됨
    });
  });

  describe('번역 + 리뷰 연쇄 (Integration)', () => {
    it.skip('번역 완료 후 자동으로 리뷰 가능 상태', () => {
      // Phase 5 완료 → Phase 6 리뷰 시작 가능
    });

    it('리뷰 이슈를 반영하여 재번역 컨텍스트를 프롬프트에 포함', async () => {
      const model = createMockChatModel(MOCK_TRANSLATION_RESPONSE);
      vi.mocked(createChatModel).mockReturnValue(model as never);

      const reviewIssues: ReviewIssue[] = [
        {
          id: 'issue-1',
          segmentOrder: 0,
          segmentGroupId: 'seg-0',
          sourceExcerpt: 'API endpoint',
          targetExcerpt: 'API URL',
          suggestedFix: 'API endpoint',
          type: 'terminology',
          severity: 'major',
          description: 'Terminology mismatch',
          checked: true,
        },
      ];

      await translateWithStreaming({
        project: mockProject,
        sourceDocJson,
        reviewIssues,
        retranslateMessage: '검수 이슈를 반영해 다시 번역해줘',
      });

      const [messages] = model.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      const systemPrompt = String(messages[0]?.content ?? '');
      expect(systemPrompt).toContain('[검수 이슈 - 반드시 수정 필요!]');
      expect(systemPrompt).toContain('용어 불일치');
      expect(systemPrompt).toContain('API endpoint');
      expect(systemPrompt).toContain('Terminology mismatch');
      expect(systemPrompt).toContain('[사용자 추가 지시사항]');
      expect(systemPrompt).toContain('검수 이슈를 반영해 다시 번역해줘');
    });
  });

  describe('이어서 번역 (continuation)', () => {
    const remainingSourceDoc: TipTapDocJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Remaining tail paragraph.' }] },
      ],
    };

    it('직전 번역 참고를 system에 넣고, user에는 남은 sub-doc만 넣는다', async () => {
      const model = createMockChatModel(MOCK_TRANSLATION_RESPONSE);
      vi.mocked(createChatModel).mockReturnValue(model as never);

      await translateWithStreaming({
        project: mockProject,
        sourceDocJson: remainingSourceDoc,
        continuation: {
          contextPairs: [
            { source: 'Already translated head.', target: 'Ya traducido.' },
            { source: 'Second head.', target: 'Segundo.' },
          ],
        },
      });

      const [messages] = model.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      const systemPrompt = String(messages[0]?.content ?? '');
      const userPrompt = String(messages[1]?.content ?? '');

      expect(systemPrompt).toContain('[이어서 번역]');
      expect(systemPrompt).toContain('[직전 번역 참고]');
      expect(systemPrompt).toContain('(원문) Already translated head.');
      expect(systemPrompt).toContain('(번역) Ya traducido.');
      expect(systemPrompt).toContain('(원문) Second head.');
      // 참고 문맥 재번역 금지 지시가 빠지면 모델이 앞부분을 되받아쓴다
      expect(systemPrompt).toContain('INPUT_DOCUMENT만 번역하세요.');

      // INPUT_DOCUMENT에는 남은 부분만 — 참고 문맥이 입력으로 새면 중복 번역된다
      expect(userPrompt).toContain('Remaining tail paragraph.');
      expect(userPrompt).not.toContain('Already translated head.');
      expect(userPrompt).not.toContain('Ya traducido.');
    });

    it('continuation이 없으면 이어서 번역 섹션을 넣지 않는다', async () => {
      const model = createMockChatModel(MOCK_TRANSLATION_RESPONSE);
      vi.mocked(createChatModel).mockReturnValue(model as never);

      await translateWithStreaming({ project: mockProject, sourceDocJson });

      const [messages] = model.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      const systemPrompt = String(messages[0]?.content ?? '');
      expect(systemPrompt).not.toContain('[이어서 번역]');
      expect(systemPrompt).not.toContain('[직전 번역 참고]');
    });

    it('참고 쌍이 비어 있으면 섹션을 넣지 않는다', async () => {
      const model = createMockChatModel(MOCK_TRANSLATION_RESPONSE);
      vi.mocked(createChatModel).mockReturnValue(model as never);

      await translateWithStreaming({
        project: mockProject,
        sourceDocJson: remainingSourceDoc,
        continuation: { contextPairs: [] },
      });

      const [messages] = model.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      expect(String(messages[0]?.content ?? '')).not.toContain('[이어서 번역]');
    });
  });
});
