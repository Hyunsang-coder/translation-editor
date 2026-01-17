import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReviewStore, type ReviewIntensity, type ReviewIssue } from '@/stores/reviewStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { runReview } from '@/ai/review/runReview';
import { parseReviewResult } from '@/ai/review/parseReviewResult';
import { buildAlignedChunks } from '@/ai/tools/reviewTool';
import { searchGlossary } from '@/tauri/glossary';
import { ReviewResultsTable } from '@/components/review/ReviewResultsTable';
import { getTargetEditor } from '@/editor/editorRegistry';
import { normalizeForSearch } from '@/utils/normalizeForSearch';
import { stripHtml } from '@/utils/hash';

/** 검수 강도 선택 드롭다운 */
function IntensitySelect({
  value,
  onChange,
  disabled,
}: {
  value: ReviewIntensity;
  onChange: (value: ReviewIntensity) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-editor-muted whitespace-nowrap">
        {t('review.intensity', '검수 강도')}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ReviewIntensity)}
        disabled={disabled}
        className="flex-1 px-2 py-1 text-xs rounded border border-editor-border bg-editor-bg focus:outline-none focus:ring-1 focus:ring-primary-500/50 disabled:opacity-50"
      >
        <option value="minimal">{t('review.intensity.minimal', '가볍게')}</option>
        <option value="balanced">{t('review.intensity.balanced', '기본')}</option>
        <option value="thorough">{t('review.intensity.thorough', '꼼꼼히')}</option>
      </select>
    </div>
  );
}

/**
 * Review Panel 컴포넌트
 * ChatPanel의 Review 탭에서 렌더링됩니다.
 */
export function ReviewPanel(): JSX.Element {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  // Note: translationRules/projectContext는 useCallback 내에서 getState()로 직접 가져옴
  // 검수 중 규칙이 변경되어도 각 청크 처리 시 최신 값 사용 (Issue #13 Fix)

  const {
    // 검수 설정
    intensity,
    setIntensity,
    // 검수 실행 상태
    results,
    isReviewing,
    totalIssuesFound,
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
    setIsApplyingSuggestion,
  } = useReviewStore();

  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // 패널이 열릴 때 초기화 (스토어에서 프로젝트 ID 체크하여 중복 초기화 방지)
  useEffect(() => {
    if (project) {
      initializeReview(project);
    }
  }, [project, initializeReview]);

  const handleRunReview = useCallback(async () => {
    if (!project) return;

    // 검수 시작 시 최신 문서로 chunks 재생성 (캐시된 chunks 대신)
    const freshChunks = buildAlignedChunks(project);
    if (freshChunks.length === 0) return;

    const controller = new AbortController();
    setAbortController(controller);
    startReview();

    // Glossary 검색 (첫 청크 기반)
    let glossaryText = '';
    try {
      if (project.id && freshChunks[0]) {
        const chunkText = freshChunks[0].segments
          .map((s) => `${s.sourceText}\n${s.targetText}`)
          .join('\n')
          .slice(0, 4000);
        if (chunkText.trim().length > 0) {
          const hits = await searchGlossary({
            projectId: project.id,
            query: chunkText,
            domain: project.metadata.domain,
            limit: 40,
          });
          if (hits.length > 0) {
            glossaryText = hits
              .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
              .join('\n');
          }
        }
      }
    } catch {
      // Glossary 검색 실패 시 무시
    }

    try {
      for (let i = 0; i < freshChunks.length; i++) {
        if (controller.signal.aborted) break;

        const chunk = freshChunks[i]!;

        try {
          // Issue #13 Fix: 각 청크 처리 시 최신 번역 규칙 가져오기
          const currentRules = useChatStore.getState().translationRules;

          // 검수 전용 함수 호출 (도구 없이 단순 API 호출)
          const response = await runReview({
            segments: chunk.segments,
            intensity,
            translationRules: currentRules,
            glossary: glossaryText,
            abortSignal: controller.signal,
          });

          // Issue #8 Fix: parseReviewResult try-catch 래핑
          let issues: ReturnType<typeof parseReviewResult>;
          try {
            issues = parseReviewResult(response);
          } catch (parseError) {
            console.error(`[ReviewPanel] Failed to parse review result for chunk ${i}:`, parseError);
            handleChunkError(i, parseError instanceof Error ? parseError : new Error('JSON 파싱 실패'));
            continue; // 다음 청크 계속 진행
          }

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
    intensity,
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

  const handleApplySuggestion = useCallback((issue: ReviewIssue) => {
    const { addToast } = useUIStore.getState();
    const editor = getTargetEditor();

    if (!issue.targetExcerpt || issue.suggestedFix === undefined) {
      addToast({
        type: 'error',
        message: t('review.applyError.missingData'),
      });
      return;
    }

    if (!editor) {
      addToast({
        type: 'error',
        message: t('review.applyError.notFound'),
      });
      return;
    }

    // 빈 suggestedFix = 삭제 제안
    if (issue.suggestedFix === '') {
      if (!window.confirm(t('review.applyConfirm.delete'))) return;
    }

    // 검색용: 마크다운 서식/리스트 마커 제거 (에디터는 plain text 기반 검색)
    const searchText = normalizeForSearch(issue.targetExcerpt);
    // 교체용: suggestedFix는 그대로 사용 (AI가 순수 텍스트로 반환)
    const replaceText = issue.suggestedFix;

    // 에디터에서 검색
    editor.commands.setSearchTerm(searchText);

    // 매치가 있는지 확인
    const matches = editor.storage.searchHighlight?.matches || [];
    if (matches.length === 0) {
      addToast({
        type: 'error',
        message: t('review.applyError.notFound'),
      });
      // 검색어 초기화
      editor.commands.setSearchTerm('');
      return;
    }

    // 적용 중 플래그 설정 (하이라이트 무효화 방지)
    setIsApplyingSuggestion(true);

    // 첫 번째 매치 교체
    editor.commands.replaceMatch(replaceText);

    // 검색어 초기화
    editor.commands.setSearchTerm('');

    deleteIssue(issue.id);

    setTimeout(() => {
      setIsApplyingSuggestion(false);
    }, 500);

    addToast({
      type: 'success',
      message: t('review.applySuccess'),
    });
  }, [t, deleteIssue, setIsApplyingSuggestion]);

  /**
   * 누락 유형: suggestedFix를 클립보드에 복사
   * 번역문에 없는 텍스트이므로 자동 적용이 불가능하여 수동 삽입 유도
   */
  const handleCopySuggestion = useCallback(async (issue: ReviewIssue) => {
    const { addToast } = useUIStore.getState();

    if (!issue.suggestedFix) {
      addToast({
        type: 'error',
        message: t('review.applyError.missingData'),
      });
      return;
    }

    try {
      // HTML 태그 제거 후 복사
      const cleanText = stripHtml(issue.suggestedFix).trim();
      await navigator.clipboard.writeText(cleanText);
      addToast({
        type: 'success',
        message: t('review.copySuccess', '클립보드에 복사되었습니다. 적절한 위치에 붙여넣어 주세요.'),
      });
    } catch {
      addToast({
        type: 'error',
        message: t('review.copyError', '클립보드 복사에 실패했습니다.'),
      });
    }
  }, [t]);

  const handleReset = useCallback(() => {
    if (isReviewing) {
      handleCancel();
    }
    resetReview(); // 내부에서 하이라이트 비활성화 + nonce 증가 처리
  }, [isReviewing, handleCancel, resetReview]);

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
          <div className="space-y-6">
            {/* 안내 메시지 */}
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-500/10 mb-4">
                <svg className="w-6 h-6 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <p className="text-editor-muted text-sm">
                {t('review.readyToStart', '검수를 시작하려면 아래 버튼을 클릭하세요.')}
              </p>
            </div>

            {/* 검수 강도 선택 */}
            <div className="max-w-xs mx-auto">
              <IntensitySelect
                value={intensity}
                onChange={setIntensity}
              />
            </div>
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
              {t('review.analyzing', '번역을 분석하고 있습니다...')}
            </p>
          </div>
        ) : (
          // 검수 결과 표시
          <div className="space-y-4">
            {/* 검수 강도 선택 (결과 화면 상단) */}
            <div className="flex items-center justify-between">
              <div className="w-48">
                <IntensitySelect
                  value={intensity}
                  onChange={setIntensity}
                  disabled={isReviewing}
                />
              </div>
            </div>

            {hasErrors && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-500">
                {t('review.hasErrors', '일부 청크에서 오류가 발생했습니다.')}
              </div>
            )}
            <ReviewResultsTable
              issues={allIssues}
              onToggleCheck={toggleIssueCheck}
              onDelete={deleteIssue}
              onApply={handleApplySuggestion}
              onCopy={handleCopySuggestion}
              onToggleAll={() => setAllIssuesChecked(!allChecked)}
              allChecked={allChecked}
              totalIssuesFound={totalIssuesFound}
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
              {results.length > 0 && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-1.5 text-xs rounded border border-editor-border hover:bg-editor-bg transition-colors"
                >
                  {t('review.reset', '초기화')}
                </button>
              )}
              <button
                type="button"
                onClick={handleRunReview}
                disabled={!project}
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
