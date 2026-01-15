import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReviewStore, type ReviewIntensity, type ReviewIssue } from '@/stores/reviewStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { streamAssistantReply } from '@/ai/chat';
import { parseReviewResult } from '@/ai/review/parseReviewResult';
import { buildReviewPrompt, buildAlignedChunks } from '@/ai/tools/reviewTool';
import { ReviewResultsTable } from '@/components/review/ReviewResultsTable';
import { getTargetEditor } from '@/editor/editorRegistry';

/** 체크박스 아이템 컴포넌트 */
function CheckboxItem({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 w-4 h-4 rounded border-editor-border text-primary-500 focus:ring-primary-500/20 bg-editor-bg"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-editor-text group-hover:text-primary-500 transition-colors">
          {label}
        </div>
        <div className="text-xs text-editor-muted">{description}</div>
      </div>
    </label>
  );
}

/** 아코디언 아이콘 */
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-editor-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
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
    categories,
    settingsExpanded,
    setIntensity,
    toggleCategory,
    setSettingsExpanded,
    // 검수 실행 상태
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
    setIsApplyingSuggestion,
  } = useReviewStore();

  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // 패널이 열릴 때 초기화 (스토어에서 프로젝트 ID 체크하여 중복 초기화 방지)
  useEffect(() => {
    if (project) {
      initializeReview(project);
    }
  }, [project, initializeReview]);

  // 검수 항목이 하나라도 선택되어 있는지 확인
  const hasEnabledCategories = Object.values(categories).some(Boolean);

  const runReview = useCallback(async () => {
    if (!project) return;

    // 검수 항목이 하나도 선택되지 않았으면 실행하지 않음
    if (!hasEnabledCategories) return;

    // 검수 시작 시 최신 문서로 chunks 재생성 (캐시된 chunks 대신)
    const freshChunks = buildAlignedChunks(project);
    if (freshChunks.length === 0) return;

    const controller = new AbortController();
    setAbortController(controller);
    startReview();

    // 검수 설정 기반 동적 프롬프트 생성
    const reviewInstructions = buildReviewPrompt(intensity, categories);

    try {
      for (let i = 0; i < freshChunks.length; i++) {
        if (controller.signal.aborted) break;

        const chunk = freshChunks[i]!;
        const segmentsText = chunk.segments
          .map((s) => `[#${s.order}]\nSource: ${s.sourceText}\nTarget: ${s.targetText}`)
          .join('\n\n');

        const userMessage = `${reviewInstructions}

## 검수 대상
${segmentsText}

반드시 위 출력 형식의 JSON만 출력하세요. 설명이나 마크다운 없이 JSON만 출력합니다.
문제가 없으면: { "issues": [] }`;

        try {
          // Issue #13 Fix: 각 청크 처리 시 최신 번역 규칙/컨텍스트 가져오기
          const currentState = useChatStore.getState();
          const currentRules = currentState.translationRules;
          const currentContext = currentState.projectContext;

          const response = await streamAssistantReply(
            {
              project,
              contextBlocks: [],
              recentMessages: [],
              userMessage,
              translationRules: currentRules,
              projectContext: currentContext,
              requestType: 'question',
              abortSignal: controller.signal,
            },
            {
              onToken: () => { }, // 스트리밍 토큰은 무시
            },
          );

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
    categories,
    startReview,
    finishReview,
    addResult,
    handleChunkError,
    hasEnabledCategories,
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

    // Markdown 문법 제거하여 plain text로 검색 (에디터는 plain text 기반 검색)
    const stripMarkdown = (text: string): string => {
      return text
        .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
        .replace(/\*(.+?)\*/g, '$1')      // italic
        .replace(/__(.+?)__/g, '$1')      // bold alt
        .replace(/_(.+?)_/g, '$1')        // italic alt
        .replace(/~~(.+?)~~/g, '$1')      // strikethrough
        .replace(/`(.+?)`/g, '$1')        // inline code
        .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
        .trim();
    };

    const searchText = stripMarkdown(issue.targetExcerpt);
    const replaceText = stripMarkdown(issue.suggestedFix);

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

  const handleReset = useCallback(() => {
    if (isReviewing) {
      handleCancel();
    }
    disableHighlight(); // 검수 상태 초기화 시 하이라이트 해제
    resetReview();
  }, [isReviewing, handleCancel, disableHighlight, resetReview]);

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
              <p className="text-editor-muted">
                {t('review.readyToStart', '검수를 시작하려면 아래 버튼을 클릭하세요.')}
              </p>
            </div>

            {/* 검수 설정 - 접이식 섹션 */}
            <div className="border border-editor-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setSettingsExpanded(!settingsExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between bg-editor-surface/50 hover:bg-editor-surface transition-colors"
              >
                <span className="text-sm font-medium">{t('review.settings', '검수 설정')}</span>
                <ChevronIcon expanded={settingsExpanded} />
              </button>

              {settingsExpanded && (
                <div className="px-4 py-3 space-y-4 border-t border-editor-border">
                  {/* 검수 강도 */}
                  <div>
                    <label className="block text-xs text-editor-muted mb-2">
                      {t('review.intensity', '검수 강도')}
                    </label>
                    <select
                      value={intensity}
                      onChange={(e) => setIntensity(e.target.value as ReviewIntensity)}
                      className="w-full px-3 py-2 text-sm rounded border border-editor-border bg-editor-bg focus:outline-none focus:ring-1 focus:ring-primary-500/50"
                    >
                      <option value="minimal">{t('review.intensity.minimal', '명백한 오류만 검출')}</option>
                      <option value="balanced">{t('review.intensity.balanced', '중요한 오류 검출')}</option>
                      <option value="thorough">{t('review.intensity.thorough', '세밀하게 검토')}</option>
                    </select>
                  </div>

                  {/* 검수 항목 */}
                  <div>
                    <label className="block text-xs text-editor-muted mb-2">
                      {t('review.categories', '검수 항목')}
                    </label>
                    <div className="space-y-2">
                      <CheckboxItem
                        checked={categories.mistranslation}
                        onChange={() => toggleCategory('mistranslation')}
                        label={t('review.category.mistranslation', '오역')}
                        description={t('review.category.mistranslation.desc', '의미가 다르게 번역된 경우')}
                      />
                      <CheckboxItem
                        checked={categories.omission}
                        onChange={() => toggleCategory('omission')}
                        label={t('review.category.omission', '누락')}
                        description={t('review.category.omission.desc', '원문 정보가 빠진 경우')}
                      />
                      <CheckboxItem
                        checked={categories.distortion}
                        onChange={() => toggleCategory('distortion')}
                        label={t('review.category.distortion', '왜곡')}
                        description={t('review.category.distortion.desc', '강도/범위/조건이 변경된 경우')}
                      />
                      <CheckboxItem
                        checked={categories.consistency}
                        onChange={() => toggleCategory('consistency')}
                        label={t('review.category.consistency', '용어 일관성')}
                        description={t('review.category.consistency.desc', '같은 용어가 다르게 번역된 경우')}
                      />
                    </div>
                  </div>
                </div>
              )}
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
                onClick={runReview}
                disabled={!project || !hasEnabledCategories}
                title={!hasEnabledCategories ? t('review.noCategoriesSelected', '검수 항목을 하나 이상 선택해주세요') : undefined}
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
