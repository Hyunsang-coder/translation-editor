import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReviewStore } from '@/stores/reviewStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { streamAssistantReply } from '@/ai/chat';
import { parseReviewResult } from '@/ai/review/parseReviewResult';
import { ReviewResultsTable } from '@/components/review/ReviewResultsTable';

interface ReviewModalProps {
  open: boolean;
  onClose: () => void;
}

export function ReviewModal({ open, onClose }: ReviewModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const translationRules = useChatStore((s) => s.translationRules);
  const projectContext = useChatStore((s) => s.projectContext);

  const {
    chunks,
    results,
    isReviewing,
    initializeReview,
    addResult,
    handleChunkError,
    startReview,
    finishReview,
    resetReview,
    getAllIssues,
  } = useReviewStore();

  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // 모달이 열릴 때 초기화
  useEffect(() => {
    if (open && project) {
      initializeReview(project);
    }
  }, [open, project, initializeReview]);

  // 모달이 닫힐 때 정리
  useEffect(() => {
    if (!open) {
      if (abortController) {
        abortController.abort();
      }
    }
  }, [open, abortController]);

  const runReview = useCallback(async () => {
    if (!project || chunks.length === 0) return;

    const controller = new AbortController();
    setAbortController(controller);
    startReview(chunks);

    try {
      // 모든 청크를 순차 검수
      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) break;

        const chunk = chunks[i]!;
        const segmentsText = chunk.segments
          .map((s) => `[#${s.order}]\nSource: ${s.sourceText}\nTarget: ${s.targetText}`)
          .join('\n\n');

        const userMessage = `다음 번역을 검수하고, 반드시 아래 JSON 형식으로만 출력하세요.
설명이나 마크다운 없이 JSON만 출력합니다.

검수 대상:
${segmentsText}

출력 형식:
{
  "issues": [
    {
      "segmentOrder": 0,
      "segmentGroupId": "세그먼트 ID (있으면)",
      "type": "오역|누락|왜곡|일관성",
      "sourceExcerpt": "원문 구절 35자 이내",
      "targetExcerpt": "현재 번역 35자 이내",
      "suggestedFix": "수정 제안",
      "description": "간결한 설명"
    }
  ]
}

문제가 없으면: { "issues": [] }`;

        try {
          const response = await streamAssistantReply(
            {
              project,
              contextBlocks: [],
              recentMessages: [],
              userMessage,
              translationRules,
              projectContext,
              requestType: 'question',
            },
            {
              onToken: () => {}, // 스트리밍 토큰은 무시
            },
          );

          // AI 응답 파싱
          const issues = parseReviewResult(response);
          addResult({
            chunkIndex: i,
            issues,
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            break;
          }
          handleChunkError(i, error instanceof Error ? error : new Error('Unknown error'));
        }
      }
    } finally {
      finishReview();
      setAbortController(null);
    }
  }, [
    project,
    chunks,
    translationRules,
    projectContext,
    startReview,
    finishReview,
    addResult,
    handleChunkError,
  ]);

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
    }
    finishReview();
  }, [abortController, finishReview]);

  const handleClose = useCallback(() => {
    if (isReviewing) {
      handleCancel();
    }
    resetReview();
    onClose();
  }, [isReviewing, handleCancel, resetReview, onClose]);

  if (!open) return null;

  const allIssues = getAllIssues();
  const hasErrors = results.some((r) => r.error);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isReviewing) {
          handleClose();
        }
      }}
    >
      <div className="bg-editor-surface rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-editor-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-editor-text">
            {t('review.title', '번역 검수 결과')}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isReviewing}
            className="text-editor-muted hover:text-editor-text disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {results.length === 0 && !isReviewing ? (
            // 검수 시작 전 초기 상태
            <div className="text-center py-12">
              <p className="text-editor-muted mb-4">
                {t('review.readyToStart', '검수를 시작하려면 아래 버튼을 클릭하세요.')}
              </p>
              <p className="text-sm text-editor-muted">
                {t('review.chunkInfo', '총 {count}개 청크를 검수합니다.', { count: chunks.length })}
              </p>
            </div>
          ) : results.length === 0 && isReviewing ? (
            // 검수 진행 중이지만 아직 결과가 없는 상태
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-500/10 mb-4 animate-pulse">
                <svg className="w-6 h-6 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <p className="text-editor-muted">
                {t('review.analyzing', 'AI가 번역을 분석하고 있습니다...')}
              </p>
            </div>
          ) : (
            // 검수 결과 표시
            <div className="space-y-4">
              {hasErrors && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-500">
                  {t('review.hasErrors', '일부 청크에서 오류가 발생했습니다.')}
                </div>
              )}
              <ReviewResultsTable issues={allIssues} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-editor-border flex items-center justify-end gap-3">
          {isReviewing ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-sm rounded border border-editor-border hover:bg-editor-bg transition-colors"
            >
              {t('review.cancel', '취소')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded border border-editor-border hover:bg-editor-bg transition-colors"
              >
                {t('review.close', '닫기')}
              </button>
              <button
                type="button"
                onClick={runReview}
                disabled={chunks.length === 0}
                className="px-4 py-2 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
              >
                {results.length > 0
                  ? t('review.restart', '다시 검수')
                  : t('review.start', '검수 시작')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
