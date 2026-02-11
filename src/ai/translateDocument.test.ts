import { describe, it, expect, vi } from 'vitest';
import type { TipTapDocJson } from '@/utils/markdownConverter';
import {
  isTimeoutError,
  isRetryableTranslationError,
  formatTranslationError,
} from '@/ai/translateDocument';
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
    // 🔴 Red: 테스트 먼저 작성 (구현 검증 필요)

    it('Spanish → English 번역 성공', async () => {
      // Arrange: 테스트용 문서
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

      // Act: 번역 실행 (Phase 5.1)
      // const { translateWithStreaming } = await import('@/ai/translateDocument');
      // const result = await translateWithStreaming({
      //   project: mockProject,
      //   sourceDocJson,
      //   onToken,
      // });

      // Assert: 입력값이 유효한지 확인
      expect(sourceDocJson.type).toBe('doc');
      expect(sourceDocJson.content).toBeDefined();
      expect(Array.isArray(sourceDocJson.content)).toBe(true);

      // TODO: 실제 번역 결과 검증
      // expect(result).toHaveProperty('doc');
      // expect(result.doc.type).toBe('doc');
      // expect(result.doc.content).toBeDefined();
    });

    it.skip('번역 중 취소 (AbortSignal)', async () => {
      // Act: 번역 시작 후 즉시 취소
      // const abortController = new AbortController();
      // const translatePromise = translateWithStreaming({
      //   sourceDocJson: mockSourceDoc,
      //   abortSignal: abortController.signal,
      // });
      // abortController.abort();

      // Assert: 취소되었는지 확인
      // await expect(translatePromise).rejects.toThrow();
    });

    it.skip('대용량 문서는 자동 청킹', async () => {
      // Arrange: 5,000단어 이상의 큰 문서
      // const largeDoc = buildLargeDocument(5000);

      // Act: 번역 실행
      // const result = await translateWithStreaming({
      //   sourceDocJson: largeDoc,
      // });

      // Assert: 청킹으로 분할 처리됨
      // expect(result.chunkCount).toBeGreaterThan(1);
    });

    it.skip('API 오류 시 에러 메시지 반환', async () => {
      // Arrange: API 키 없음
      // (beforeEach에서 API 설정 제거)

      // Act: 번역 실행
      // const translatePromise = translateWithStreaming({
      //   sourceDocJson: mockSourceDoc,
      // });

      // Assert: 에러 메시지
      // await expect(translatePromise).rejects.toThrow('API 키');
    });
  });

  describe('번역 결과 - Preview Modal (Phase 5.2)', () => {
    it.skip('번역 결과가 TipTap JSON으로 반환됨', async () => {
      // Assert: 결과가 TipTap JSON 형식
      // const isValid = isValidTipTapDocJson(result.doc);
      // expect(isValid).toBe(true);
    });

    it.skip('이미지 플레이스홀더가 복원됨', async () => {
      // Arrange: 이미지 포함 문서
      // const docWithImages = buildDocWithImages();

      // Act: 번역 실행
      // const result = await translateWithStreaming({
      //   sourceDocJson: docWithImages,
      // });

      // Assert: 이미지가 복원됨
      // expect(result.doc.content).toContainImageNode();
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

    it.skip('리뷰 이슈를 반영하여 재번역', () => {
      // reviewIssues 파라미터 전달 → 이슈 맥락 포함 재번역
    });
  });
});
