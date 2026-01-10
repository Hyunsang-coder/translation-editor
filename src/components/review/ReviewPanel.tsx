import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReviewStore } from '@/stores/reviewStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { streamAssistantReply } from '@/ai/chat';
import { parseReviewResult } from '@/ai/review/parseReviewResult';
import { ReviewResultsTable } from '@/components/review/ReviewResultsTable';

/**
 * Review Panel 컴포넌트
 * ChatPanel의 Review 탭에서 렌더링됩니다.
 */
export function ReviewPanel(): JSX.Element {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const translationRules = useChatStore((s) => s.translationRules);
  const projectContext = useChatStore((s) => s.projectContext);
  const closeReviewPanel = useUIStore((s) => s.closeReviewPanel);

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
    toggleIssueCheck,
    deleteIssue,
    setAllIssuesChecked,
    getCheckedIssues,
    disableHighlight,
  } = useReviewStore();

  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // 패널이 열릴 때 초기화 (스토어에서 프로젝트 ID 체크하여 중복 초기화 방지)
  useEffect(() => {
    if (project) {
      initializeReview(project);
    }
  }, [project, initializeReview]);

  const runReview = useCallback(async () => {
    if (!project || chunks.length === 0) return;

    const controller = new AbortController();
    setAbortController(controller);
    startReview();

    try {
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
    disableHighlight(); // Review 탭 닫을 때 하이라이트 해제
    resetReview();
    closeReviewPanel();
  }, [isReviewing, handleCancel, disableHighlight, resetReview, closeReviewPanel]);

  const allIssues = getAllIssues();
  const checkedIssues = getCheckedIssues();
  const hasErrors = results.some((r) => r.error);
  const allChecked = allIssues.length > 0 && allIssues.every((i) => i.checked);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-editor-bg">
      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 && !isReviewing ? (
          // 검수 시작 전 초기 상태
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-500/10 mb-4">
              <svg className="w-6 h-6 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
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
            <ReviewResultsTable
              issues={allIssues}
              onToggleCheck={toggleIssueCheck}
              onDelete={deleteIssue}
              onToggleAll={() => setAllIssuesChecked(!allChecked)}
              allChecked={allChecked}
            />
          </div>
        )}
      </div>

      {/* 푸터 */}
      <div className="px-4 py-3 border-t border-editor-border flex items-center justify-between gap-3 bg-editor-surface/50">
        <div className="flex items-center gap-3">
          <div className="text-xs text-editor-muted">
            {checkedIssues.length > 0 && (
              <span>{t('review.selectedCount', '{count}개 선택됨', { count: checkedIssues.length })}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isReviewing ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1.5 text-xs rounded border border-editor-border hover:bg-editor-bg transition-colors"
            >
              {t('review.cancel', '취소')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 text-xs rounded border border-editor-border hover:bg-editor-bg transition-colors"
              >
                {t('review.close', '닫기')}
              </button>
              <button
                type="button"
                onClick={runReview}
                disabled={chunks.length === 0}
                className="px-3 py-1.5 text-xs rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
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
