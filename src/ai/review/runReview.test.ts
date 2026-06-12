import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AlignedSegment } from '@/ai/tools/reviewTool';
import { runReview } from './runReview';
import { parseReviewResult } from './parseReviewResult';

const mocks = vi.hoisted(() => ({
  createChatModel: vi.fn(),
  stream: vi.fn(),
  isTauriRuntime: vi.fn(),
  shouldRetryWithTauriAiBackend: vi.fn(),
  streamWithTauriAiBackend: vi.fn(),
}));

vi.mock('@/ai/client', () => ({
  createChatModel: mocks.createChatModel,
}));

vi.mock('@/tauri/invoke', () => ({
  isTauriRuntime: mocks.isTauriRuntime,
}));

vi.mock('@/ai/backendCompletion', () => ({
  shouldRetryWithTauriAiBackend: mocks.shouldRetryWithTauriAiBackend,
  streamWithTauriAiBackend: mocks.streamWithTauriAiBackend,
}));

/**
 * Phase 6: 리뷰 실행 테스트
 * 사용자 스토리: 마리아가 "Review" 버튼을 클릭하고 이슈를 받음
 */

describe('runReview - 리뷰 실행 (Phase 6.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriRuntime.mockReturnValue(false);
    mocks.shouldRetryWithTauriAiBackend.mockReturnValue(false);
    mocks.streamWithTauriAiBackend.mockResolvedValue('---REVIEW_START---\nIssues detected: 0\n---REVIEW_END---');
    mocks.stream.mockImplementation(async function* () {
      yield { content: '---REVIEW_START---\n' };
      yield { content: 'Issues detected: 0\n' };
      yield { content: '---REVIEW_END---' };
    });
    mocks.createChatModel.mockReturnValue({
      stream: mocks.stream,
    });
  });

  // ===== 모의 데이터 =====

  const mockSegments: AlignedSegment[] = [
    {
      sourceText: 'This guide provides detailed instructions',
      targetText: 'Esta guía proporciona instrucciones detalladas',
      groupId: 'seg-0',
      order: 0,
    },
    {
      sourceText: 'Basic knowledge of JavaScript',
      targetText: 'Conocimiento básico de JavaScript',
      groupId: 'seg-1',
      order: 1,
    },
  ];

  describe('리뷰 실행 기본 동작', () => {
    it('세그먼트 배열이 유효해야 함', () => {
      // Assert: 입력 데이터 검증
      expect(mockSegments).toHaveLength(2);
      expect(mockSegments[0]).toHaveProperty('sourceText');
      expect(mockSegments[0]).toHaveProperty('targetText');
      expect(mockSegments[0]).toHaveProperty('groupId');
    });

    it('groupId가 모든 세그먼트에 존재해야 함', () => {
      mockSegments.forEach((segment) => {
        expect(segment.groupId).toBeDefined();
        expect(segment.groupId).toMatch(/^seg-\d+$/);
      });
    });

    it('여러 세그먼트 순차 처리 가능', () => {
      // Act: 세그먼트별 처리
      const processed = mockSegments.map((segment, index) => ({
        chunkIndex: 0,
        order: index,
        text: segment.targetText,
      }));

      // Assert: 모든 세그먼트 처리됨
      expect(processed).toHaveLength(2);
      expect(processed[0]!.order).toBe(0);
      expect(processed[1]!.order).toBe(1);
    });
  });

  describe('리뷰 API 호출 (Phase 6.1)', () => {
    it('리뷰 API에 세그먼트 전달', async () => {
      const result = await runReview({
        segments: mockSegments,
        translationRules: 'Keep technical terms consistent',
        sourceLanguage: 'English',
        targetLanguage: 'Spanish',
      });

      expect(result).toContain('---REVIEW_START---');
      expect(mocks.createChatModel).toHaveBeenCalledWith(
        undefined,
        { useFor: 'translation', maxTokens: 4096 },
      );
      expect(mocks.stream).toHaveBeenCalledTimes(1);

      const [messages] = mocks.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      expect(messages).toHaveLength(2);
      expect(String(messages[1]?.content)).toContain('Source (English): This guide provides detailed instructions');
      expect(String(messages[1]?.content)).toContain('Target (Spanish): Esta guía proporciona instrucciones detalladas');
      expect(String(messages[1]?.content)).toContain('## 번역 규칙');
    });

    it('Tauri 런타임에서는 백엔드 스트리밍을 1차 경로로 사용', async () => {
      mocks.isTauriRuntime.mockReturnValue(true);

      const result = await runReview({
        segments: mockSegments,
        sourceLanguage: 'English',
        targetLanguage: 'Spanish',
      });

      expect(result).toContain('---REVIEW_START---');
      expect(mocks.createChatModel).not.toHaveBeenCalled();
      expect(mocks.stream).not.toHaveBeenCalled();
      expect(mocks.streamWithTauriAiBackend).toHaveBeenCalledTimes(1);

      const callArgs = mocks.streamWithTauriAiBackend.mock.calls[0]?.[0] as {
        maxTokens?: number;
        messages?: Array<{ role: string; content: string }>;
      };
      expect(callArgs.maxTokens).toBe(4096);
      expect(callArgs.messages?.[0]?.role).toBe('system');
      expect(callArgs.messages?.[1]?.content).toContain('Source (English): This guide provides detailed instructions');
      expect(callArgs.messages?.[1]?.content).toContain('Target (Spanish): Esta guía proporciona instrucciones detalladas');
    });

    it('검수 프롬프트에 원어민 자연스러움 점검 항목을 포함', async () => {
      await runReview({
        segments: mockSegments,
        sourceLanguage: 'English',
        targetLanguage: 'Spanish',
      });

      const [messages] = mocks.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
      expect(String(messages[0]?.content)).toContain('Native Naturalness Audit');
      expect(String(messages[0]?.content)).toContain('어색한 콜로케이션');
      expect(String(messages[0]?.content)).toContain('문장 구조');
    });

    it('여러 청크 순차 리뷰 (Phase 6.1 - Multiple chunks)', async () => {
      const chunk0 = [mockSegments[0]!];
      const chunk1 = [mockSegments[1]!];
      const chunk2 = mockSegments;

      const results = await Promise.all([
        runReview({ segments: chunk0 }),
        runReview({ segments: chunk1 }),
        runReview({ segments: chunk2 }),
      ]);

      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r).toContain('---REVIEW_START---'));
      expect(mocks.stream).toHaveBeenCalledTimes(3);
    });

    it('취소 신호(AbortSignal) 처리', async () => {
      const abortController = new AbortController();
      abortController.abort();

      mocks.stream.mockImplementation(async function* () {
        yield { content: 'partial result' };
      });

      await expect(
        runReview({
          segments: mockSegments,
          abortSignal: abortController.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('리뷰 결과 파싱 (Phase 6.1 → 6.2)', () => {
    it('리뷰 결과가 파싱되어 이슈 목록으로 변환됨', async () => {
      mocks.stream.mockImplementation(async function* () {
        yield { content: '---REVIEW_START---\n' };
        yield {
          content: [
            '### Issue #1',
            '- **Source**: "API endpoint"',
            '- **Target**: "URL de API"',
            '- **Type**: Terminology',
            '- **Severity**: Major',
            '- **SegmentGroupId**: seg-0',
            '- **Explanation**: Terminology mismatch',
            '- **Suggestion**: API endpoint',
          ].join('\n'),
        };
        yield { content: '\n---REVIEW_END---' };
      });

      const response = await runReview({ segments: mockSegments });
      const issues = parseReviewResult(response);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.segmentGroupId).toBe('seg-0');
      expect(issues[0]?.type).toBe('terminology');
      expect(issues[0]?.severity).toBe('major');
      expect(issues[0]?.suggestedFix).toBe('API endpoint');
    });
  });

  describe('리뷰 하이라이트 (Phase 6.2)', () => {
    it('파싱된 이슈가 segmentGroupId를 유지해 하이라이트 앵커로 사용 가능', async () => {
      mocks.stream.mockImplementation(async function* () {
        yield { content: '---REVIEW_START---\n' };
        yield {
          content: [
            '### Issue #1',
            '- **Source**: "This guide provides detailed instructions"',
            '- **Target**: "Esta guía proporciona detalles"',
            '- **Type**: Mistranslation',
            '- **Severity**: Critical',
            '- **SegmentGroupId**: seg-0',
            '- **Explanation**: Meaning loss',
            '- **Suggestion**: Esta guía proporciona instrucciones detalladas',
          ].join('\n'),
        };
        yield { content: '\n---REVIEW_END---' };
      });

      const response = await runReview({ segments: mockSegments });
      const issues = parseReviewResult(response);

      expect(issues[0]?.segmentGroupId).toBe('seg-0');
      expect(issues[0]?.sourceExcerpt).toContain('detailed instructions');
      expect(issues[0]?.targetExcerpt).toContain('detalles');
    });
  });

  describe('리뷰 이슈 적용 (Phase 6.2 - Apply Suggestion)', () => {
    it.skip('제안된 수정안을 에디터에 적용', () => {
      // Arrange: 리뷰 이슈 + 제안
      // const issue = {
      //   segmentGroupId: 'seg-0',
      //   suggestedFix: 'API endpoint',
      //   problem: 'API key와 혼동 가능',
      // };

      // Act: 제안 적용
      // applyReviewSuggestion(mockEditor, issue);

      // Assert: 에디터 콘텐츠 변경
      // expect(mockEditor.setSelection).toHaveBeenCalled();
      // expect(mockEditor.insertContent).toHaveBeenCalledWith('API endpoint');
    });

    it.skip('여러 제안 순차 적용', () => {
      // Act: 이슈 체크박스로 선택
      // toggleIssueCheck(issue1); // checked
      // toggleIssueCheck(issue2); // checked

      // Act: "적용" 버튼
      // applyCheckedSuggestions();

      // Assert: 모두 적용됨
      // expect(mockEditor.insertContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('리뷰 + 번역 연쇄 (Integration)', () => {
    it.skip('재번역: 리뷰 이슈를 반영하여 전체 문서 재번역', () => {
      // Phase 6.2 후 "재번역" 버튼
      // Arrange: 체크된 이슈들
      // const checkedIssues = [issue1, issue2];

      // Act: 재번역 실행
      // const result = await translateWithStreaming({
      //   sourceDocJson,
      //   reviewIssues: checkedIssues,
      //   retranslateMessage: '선택된 이슈들을 반영해서 재번역해주세요',
      // });

      // Assert: 새로운 번역 결과
      // expect(result.doc).toBeDefined();
      // expect(result.doc.type).toBe('doc');
    });
  });
});
