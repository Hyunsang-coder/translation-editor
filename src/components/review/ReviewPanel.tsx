import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReviewStore, type ReviewIssue } from '@/stores/reviewStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useHistoryStore } from '@/stores/historyStore';
import { getModelIdForUse } from '@/ai/config';
import { runReview } from '@/ai/review/runReview';
import { serializeUserComments } from '@/ai/commentContext';
import { useCommentStore } from '@/stores/commentStore';
import { parseReviewResult } from '@/ai/review/parseReviewResult';
import { buildAlignedChunksAsync, type AlignedChunk } from '@/ai/tools/reviewTool';
import { translateWithStreaming, type TipTapDocJson, formatTranslationError } from '@/ai/translateDocument';
import { resolveGlossaryEntries } from '@/utils/glossaryInject';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import {
  buildContextSnapshot,
  resolveWorkflowContextFromSnapshot,
} from '@/ai/context/resolveWorkflowContext';
import { ReviewResultsTable } from '@/components/review/ReviewResultsTable';
import {
  applySuggestionToEditor,
  deriveReplacementText,
  resolveSuggestionRange,
} from '@/components/review/reviewApply';
import { useEditorStore } from '@/stores/editorStore';
import { stripHtml } from '@/utils/hash';
import { stripRichTextMarkup } from '@/utils/normalizeForSearch';
import { TranslatePreviewModal } from '@/components/editor/TranslatePreviewModal';
import { tipTapJsonToHtml } from '@/utils/markdownConverter';
import { detectSourceLanguage } from '@/utils/detectLanguage';

/**
 * Review Panel 컴포넌트
 * ChatPanel의 Review 탭에서 렌더링됩니다.
 */
export function ReviewPanel(): JSX.Element {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const sourceDocument = useProjectStore((s) => s.sourceDocument);
  const targetDocument = useProjectStore((s) => s.targetDocument);
  // 자주 변경되는 필드 → 별도 selector (리렌더 최소화)
  const streamingText = useReviewStore((s) => s.streamingText);
  const reviewTrigger = useReviewStore((s) => s.reviewTrigger);

  // 덜 변경되는 필드 + 필터 → 개별 selector (무한 루프 방지)
  const severityFilter = useReviewStore((s) => s.severityFilter);
  const toggleSeverityFilter = useReviewStore((s) => s.toggleSeverityFilter);
  const results = useReviewStore((s) => s.results);
  const isReviewing = useReviewStore((s) => s.isReviewing);
  const totalIssuesFound = useReviewStore((s) => s.totalIssuesFound);
  const progress = useReviewStore((s) => s.progress);

  // 액션 함수들 (참조 항상 동일)
  const initializeReview = useReviewStore((s) => s.initializeReview);
  const addResult = useReviewStore((s) => s.addResult);
  const handleChunkError = useReviewStore((s) => s.handleChunkError);
  const startReview = useReviewStore((s) => s.startReview);
  const finishReview = useReviewStore((s) => s.finishReview);
  const resetReview = useReviewStore((s) => s.resetReview);
  const getAllIssues = useReviewStore((s) => s.getAllIssues);
  const toggleIssueCheck = useReviewStore((s) => s.toggleIssueCheck);
  const deleteIssue = useReviewStore((s) => s.deleteIssue);
  const setAllIssuesChecked = useReviewStore((s) => s.setAllIssuesChecked);
  const getCheckedIssues = useReviewStore((s) => s.getCheckedIssues);
  const setStreamingText = useReviewStore((s) => s.setStreamingText);

  // 검수 루프 중단 컨트롤러 (프로젝트 전환 effect에서도 abort할 수 있도록 ref로 보관)
  const reviewAbortRef = useRef<AbortController | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // 재번역 중간 모달 (지시사항 입력)
  const [retranslateModalOpen, setRetranslateModalOpen] = useState(false);
  const [retranslateMessage, setRetranslateMessage] = useState('');

  // 재번역 상태 (TranslatePreviewModal 연동)
  const [retranslatePreviewOpen, setRetranslatePreviewOpen] = useState(false);
  const [retranslatePreviewDoc, setRetranslatePreviewDoc] = useState<TipTapDocJson | null>(null);
  // 선택 적용 diff 기준: 재번역 시작 시점의 Target 문서 스냅샷
  const [retranslateOriginalDocJson, setRetranslateOriginalDocJson] = useState<TipTapDocJson | null>(null);
  const [retranslateLoading, setRetranslateLoading] = useState(false);
  const [retranslateError, setRetranslateError] = useState<string | null>(null);
  const [retranslateStreamingText, setRetranslateStreamingText] = useState<string>('');
  const retranslateAbortController = useRef<AbortController | null>(null);
  // 청크 캐시 (검수/재번역에서 사용)
  const chunksRef = useRef<AlignedChunk[]>([]);

  // 경과 시간 타이머 — 검수 완료 후에도 최종 경과 시간 보존
  // (리셋은 startReview 호출 시 수행)
  useEffect(() => {
    if (!isReviewing) return;

    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isReviewing]);

  // 프로젝트 전환 감지용 이전 ID (마운트 시 abort 방지 위해 현재 ID로 초기화)
  const prevProjectIdRef = useRef<string | null>(project?.id ?? null);

  // 패널이 열릴 때 초기화 (스토어에서 프로젝트 ID 체크하여 중복 초기화 방지)
  // 프로젝트가 전환되면 진행 중인 검수/재번역을 즉시 중단한다 (L4):
  // 검수 루프가 계속 돌면 구 프로젝트 이슈가 새 프로젝트 상태/품질 장부에 주입된다.
  // (switchProjectById에는 review abort 신호가 없으므로 패널 로컬에서 동일 효과 구현)
  useEffect(() => {
    const nextId = project?.id ?? null;
    if (prevProjectIdRef.current !== nextId) {
      prevProjectIdRef.current = nextId;

      // 진행 중 검수 루프 중단
      reviewAbortRef.current?.abort();
      reviewAbortRef.current = null;

      // 진행 중 재번역 중단 + 프리뷰/설정 모달 닫기 (다른 프로젝트 문서에 적용 방지)
      retranslateAbortController.current?.abort();
      setRetranslateModalOpen(false);
      setRetranslatePreviewOpen(false);
      setRetranslatePreviewDoc(null);
      setRetranslateOriginalDocJson(null);
      setRetranslateLoading(false);
      setRetranslateError(null);
      setRetranslateStreamingText('');
    }
    if (project) {
      initializeReview(project);
    }
  }, [project, initializeReview]);

  // 외부에서 검수 트리거 시 handleRunReview 실행을 위한 ref
  const handleRunReviewRef = useRef<(() => Promise<void>) | null>(null);
  // 이전 trigger 값 추적 (마운트 시 실행 방지)
  const prevTriggerRef = useRef(reviewTrigger);

  // reviewTrigger 증가 감지하여 검수 시작 (마운트 시에는 실행 안됨)
  useEffect(() => {
    if (reviewTrigger > prevTriggerRef.current && handleRunReviewRef.current) {
      handleRunReviewRef.current();
    }
    prevTriggerRef.current = reviewTrigger;
  }, [reviewTrigger]);

  const handleRunReview = useCallback(async () => {
    // Snapshot: deps에 project?.id만 사용하므로 콜백 내에서 최신 project 참조
    const project = useProjectStore.getState().project;
    if (!project) return;

    // 이중 실행 가드 (L4): 이미 검수 중이면 무시
    if (useReviewStore.getState().isReviewing) return;

    // Pre-check: 변환 파이프라인 거치기 전에 원본 HTML로 직접 빈 문서 검증
    // buildAlignedChunksAsync의 markdown 변환은 <p></p> 등을 빈 문자열로 정확히 변환하지 못할 수 있음
    const { sourceDocument, targetDocument } = useProjectStore.getState();
    const sourceText = stripHtml(sourceDocument || '').trim();
    const targetText = stripHtml(targetDocument || '').trim();
    if (!sourceText || !targetText) {
      useUIStore.getState().addToast({
        type: 'warning',
        message: !sourceText
          ? t('review.emptySource', '원문이 비어있습니다. 원문을 먼저 입력해주세요.')
          : t('review.emptyTarget', '번역문이 비어있습니다. 번역을 먼저 실행해주세요.'),
      });
      return;
    }

    // 이중 실행 창 제거 (L4): chunk 빌드(await) 전에 실행 슬롯을 원자적으로 획득해
    // isReviewing을 즉시 true로 만든다. (위 가드~여기까지 동기 구간이라 재진입 불가)
    if (!useReviewStore.getState().acquireReviewRun(project.id)) return;

    // 프로젝트 전환 감지용 스냅샷 (L4): 루프/장부 기록은 이 ID 기준으로만 수행
    const startProjectId = project.id;
    const {
      translationRules: translationRulesAtStart,
      projectContext: legacyProjectContextAtStart,
    } = useChatStore.getState();
    const memoryAtStart = useProjectMemoryStore.getState();
    setElapsedSeconds(0);

    // 검수 시작 시 최신 문서로 chunks 재생성 (캐시된 chunks 대신)
    // 비동기로 처리하여 UI 블로킹 방지
    const freshChunks = await buildAlignedChunksAsync(project);

    // chunk 빌드 동안 프로젝트가 전환됐으면 중단.
    // 획득한 실행 슬롯을 반드시 반납한다: 새 프로젝트의 initializeReview가 상태를
    // 재설정한다고 가정할 수 없다(사이드바 숨김으로 ReviewPanel이 언마운트되면 그
    // effect가 안 돌아 isReviewing=true가 고착됨).
    if (useProjectStore.getState().project?.id !== startProjectId) {
      useReviewStore.getState().releaseReviewRun();
      return;
    }

    if (freshChunks.length === 0) {
      useReviewStore.getState().releaseReviewRun();
      useUIStore.getState().addToast({
        type: 'warning',
        message: t('review.emptyDocument', '검수할 내용이 없습니다. 원문과 번역문을 먼저 입력해주세요.'),
      });
      return;
    }

    // 청크 캐싱 (재번역에서 사용)
    chunksRef.current = freshChunks;

    const controller = new AbortController();
    reviewAbortRef.current = controller;
    startReview(freshChunks);

    try {
      const reviewText = freshChunks
        .flatMap((chunk) => chunk.segments)
        .map((segment) => `${segment.sourceText}\n${segment.targetText}`)
        .join('\n');
      const glossaryEntries = await resolveGlossaryEntries({
        projectId: startProjectId,
        text: reviewText,
        domain: project.metadata.domain,
        limit: 40,
      });
      const resolvedContext = resolveWorkflowContextFromSnapshot({
        mode: 'review',
        snapshot: buildContextSnapshot({
          revision: memoryAtStart.revision,
          projectMemoryItems: memoryAtStart.items,
          legacyProjectContext: legacyProjectContextAtStart,
          translationRules: translationRulesAtStart,
          forbiddenTerms: memoryAtStart.forbiddenTerms,
          glossaryEntries,
        }),
      });

      for (let i = 0; i < freshChunks.length; i++) {
        if (controller.signal.aborted) break;
        // 프로젝트 전환 감지 (L4): 구 프로젝트 이슈가 새 프로젝트 상태/장부에 주입되는 것 방지
        if (useProjectStore.getState().project?.id !== startProjectId) break;

        const chunk = freshChunks[i]!;

        try {
          // 인라인 코멘트 → 이 청크의 세그먼트 범위로 한정해 직렬화 후 주입
          // (대조 검수는 source/target 양쪽 코멘트 모두 맥락으로 사용)
          const chunkGroupIds = new Set(chunk.segments.map((s) => s.groupId));
          const serializedComments = serializeUserComments(
            useCommentStore.getState().comments,
            {
              segmentGroupIds: chunkGroupIds,
              leadIn: '아래는 번역가가 특정 구절에 남긴 코멘트입니다. 검수 시 맥락으로 반드시 고려하세요:',
            },
          );

          // 검수 전용 함수 호출 (도구 없이 단순 API 호출)
          // 언어 정보: sourceLanguage는 자동 감지, targetLanguage는 프로젝트 설정에서 가져옴
          const response = await runReview({
            segments: chunk.segments,
            resolvedContext,
            sourceLanguage: detectSourceLanguage(
              chunk.segments.slice(0, 3).map((s) => s.sourceText).join(' '),
            ),
            targetLanguage: project.metadata.targetLanguage,
            ...(serializedComments ? { userComments: serializedComments } : {}),
            abortSignal: controller.signal,
            onToken: (text) => setStreamingText(text),
          });

          // await 동안 프로젝트가 전환/취소됐으면 이 청크 결과는 폐기 (L4)
          if (
            controller.signal.aborted ||
            useProjectStore.getState().project?.id !== startProjectId
          ) {
            break;
          }

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
          // 전환 후 도착한 에러는 새 프로젝트 진행 상태를 오염시키지 않도록 폐기 (L4)
          if (useProjectStore.getState().project?.id !== startProjectId) {
            break;
          }
          handleChunkError(i, error instanceof Error ? error : new Error('Unknown error'));
        }
      }
    } finally {
      const switched = useProjectStore.getState().project?.id !== startProjectId;
      if (!controller.signal.aborted && !switched) {
        // 정상 완료: 이슈 집계 + isReviewing=false
        finishReview();
      } else if (switched && useReviewStore.getState().initializedProjectId === startProjectId) {
        // 프로젝트 전환으로 조기 종료(switch effect가 abort + reviewAbortRef=null).
        // 취소(handleCancel)는 !switched라 여기 안 걸리고 이미 finishReview()로 반납됨.
        // 전환은 새 프로젝트의 initializeReview가 상태를 재설정한다고 가정할 수 없어
        // (사이드바 숨김으로 ReviewPanel 언마운트 시 그 effect 미실행) isReviewing이
        // 고착되므로 반납한다. initializedProjectId가 여전히 이 run(startProjectId)
        // 소유일 때만 반납해, 그 사이 새로 시작/초기화된 검수 슬롯은 건드리지 않는다.
        useReviewStore.getState().releaseReviewRun();
      }
      if (reviewAbortRef.current === controller) {
        reviewAbortRef.current = null;
      }
    }
  }, [
    startReview,
    finishReview,
    addResult,
    handleChunkError,
    setStreamingText,
    t,
  ]);

  // ref에 최신 handleRunReview 할당
  useEffect(() => {
    handleRunReviewRef.current = handleRunReview;
  }, [handleRunReview]);

  const handleCancel = useCallback(() => {
    if (reviewAbortRef.current) {
      reviewAbortRef.current.abort();
      reviewAbortRef.current = null; // 메모리 누수 방지: abort 후 즉시 참조 해제
    }
    finishReview();
  }, [finishReview]);

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
      // HTML/Markdown 서식을 제거한 plain text만 복사
      const cleanText = stripRichTextMarkup(issue.suggestedFix);
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

  /**
   * 오역/문법 등 유형: targetExcerpt를 에디터에서 찾아 suggestedFix로 교체
   * 성공 시 이슈를 목록에서 제거 (Ctrl+Z로 되돌리기 가능)
   */
  // 이슈가 가리키는 구절을 번역문 에디터에서 선택·포커스한다.
  // 적용과 같은 탐색 로직(resolveSuggestionRange)을 쓰므로 적용 대상과 항상 일치한다.
  const handleViewInDocument = useCallback((issue: ReviewIssue) => {
    const { addToast } = useUIStore.getState();
    const targetEditor = useEditorStore.getState().targetEditor;

    if (!targetEditor || targetEditor.isDestroyed) {
      addToast({
        type: 'error',
        message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.'),
      });
      return;
    }

    const range = resolveSuggestionRange(
      targetEditor.state.doc,
      issue.targetExcerpt,
      issue.segmentGroupId,
      deriveReplacementText(issue.suggestedFix),
    );
    if (!range) {
      addToast({
        type: 'warning',
        message: t('review.viewNotFound', '본문에서 해당 구절을 찾지 못했습니다.'),
      });
      return;
    }

    targetEditor.commands.setTextSelection({ from: range.from, to: range.to });
    targetEditor.commands.focus();
  }, [t]);

  const handleApplySuggestion = useCallback((issue: ReviewIssue) => {
    const { addToast } = useUIStore.getState();
    const targetEditor = useEditorStore.getState().targetEditor;

    if (!targetEditor || targetEditor.isDestroyed) {
      addToast({
        type: 'error',
        message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.'),
      });
      return;
    }

    let status: ReturnType<typeof applySuggestionToEditor>;
    try {
      status = applySuggestionToEditor(targetEditor, issue);
    } catch (error) {
      // 예상 실패(not-found/missing-data)는 반환값으로 신호되므로, 여기 도달하는 것은
      // dispatch 중 plugin/React 오류 등 예기치 못한 예외다. not-found로 오진단하지 않는다.
      console.error('[ReviewPanel] apply suggestion failed:', error, {
        targetExcerpt: issue.targetExcerpt,
        segmentGroupId: issue.segmentGroupId,
      });
      addToast({
        type: 'error',
        message: t('review.applyError.unexpected', '수정 제안 적용 중 오류가 발생했습니다.'),
      });
      return;
    }

    if (status === 'applied' || status === 'applied-fuzzy') {
      deleteIssue(issue.id);
      addToast({
        type: 'success',
        message: status === 'applied-fuzzy'
          ? t('review.fuzzyMatchApplied', '유사 매칭으로 수정 제안이 적용되었습니다.')
          : t('review.applySuccess', '수정 제안이 적용되었습니다.'),
      });
    } else if (status === 'not-found') {
      console.warn('[ReviewPanel] suggestion target not found:', {
        targetExcerpt: issue.targetExcerpt,
        segmentGroupId: issue.segmentGroupId,
      });
      addToast({
        type: 'error',
        message: t('review.applyError.notFound', '텍스트를 찾을 수 없습니다. 문서가 변경되었을 수 있어요.'),
      });
    } else {
      addToast({
        type: 'error',
        message: t('review.applyError.missingData', '수정 제안 데이터가 없습니다.'),
      });
    }
  }, [deleteIssue, t]);

  /**
   * 재번역 버튼 클릭 - 중간 모달 열기
   */
  const handleRetranslateClick = useCallback(() => {
    const checkedIssues = getCheckedIssues();
    if (checkedIssues.length === 0 || !project) return;

    // Snapshot: avoid subscribing to sourceDocJson — only needed at click time
    const sourceDocJson = useProjectStore.getState().sourceDocJson;
    if (!sourceDocJson) {
      useUIStore.getState().addToast({
        type: 'warning',
        message: t('review.retranslate.noSegments', '재번역할 세그먼트가 없습니다. 먼저 검수를 실행해주세요.'),
      });
      return;
    }

    // 중간 모달 열기
    setRetranslateModalOpen(true);
    setRetranslateMessage('');
  }, [project, getCheckedIssues, t]);

  /**
   * 체크된 이슈를 반영하여 재번역 실행
   */
  const handleRetranslateExecute = useCallback(async () => {
    // 이중 클릭/재진입 가드 (L5): 실행 중이면 무시
    // (controller는 아래 동기 구간에서 세팅되고 finally에서 해제되므로 재진입 창이 없음)
    if (retranslateAbortController.current) return;

    const checkedIssues = getCheckedIssues();
    // 실행 시점의 최신 프로젝트 참조 (async 중 프로젝트 전환 대비)
    const currentProject = useProjectStore.getState().project;
    if (checkedIssues.length === 0 || !currentProject) return;

    const sourceDocJson = useProjectStore.getState().sourceDocJson;
    if (!sourceDocJson) return;

    // 프로젝트 ID 스냅샷 (완료 후 stale 검증용)
    const startProjectId = currentProject.id;

    // 중간 모달 닫기
    setRetranslateModalOpen(false);

    // 재번역 시작 - 프리뷰 모달 열기
    setRetranslatePreviewOpen(true);
    setRetranslateLoading(true);
    setRetranslateError(null);
    setRetranslatePreviewDoc(null);
    setRetranslateStreamingText('');

    // 선택 적용 diff 기준: 현재 Target 문서 스냅샷
    const targetEditor = useEditorStore.getState().targetEditor;
    setRetranslateOriginalDocJson(
      targetEditor ? (targetEditor.getJSON() as TipTapDocJson) : null,
    );

    const controller = new AbortController();
    retranslateAbortController.current = controller;

    try {
      const {
        translationRules,
        projectContext: legacyProjectContextAtStart,
      } = useChatStore.getState();
      const memoryAtStart = useProjectMemoryStore.getState();

      // 용어집 검색 (문서 전역 윈도우)
      let glossaryEntries: Awaited<ReturnType<typeof resolveGlossaryEntries>> = [];
      try {
        const sourceDocument = useProjectStore.getState().sourceDocument;
        if ((sourceDocument || '').trim() && currentProject.id) {
          glossaryEntries = await resolveGlossaryEntries({
            projectId: currentProject.id,
            text: sourceDocument || '',
            domain: currentProject.metadata.domain,
            limit: 30,
          });
        }
      } catch {
        // 용어집 검색 실패 무시
      }
      const resolvedContext = resolveWorkflowContextFromSnapshot({
        mode: 'full-translate',
        snapshot: buildContextSnapshot({
          revision: memoryAtStart.revision,
          projectMemoryItems: memoryAtStart.items,
          legacyProjectContext: legacyProjectContextAtStart,
          translationRules,
          forbiddenTerms: memoryAtStart.forbiddenTerms,
          glossaryEntries,
        }),
      });

      // 기존 번역 함수 사용 (검수 이슈 + 사용자 메시지 컨텍스트 포함)
      const trimmedMessage = retranslateMessage.trim();
      const serializedComments = serializeUserComments(
        useCommentStore.getState().comments,
        {
          leadIn: '아래는 번역가가 특정 구절에 남긴 코멘트입니다. 재번역 시 반드시 반영하세요:',
        },
      );
      const { doc } = await translateWithStreaming({
        project: currentProject,
        sourceDocJson,
        resolvedContext,
        reviewIssues: checkedIssues,
        ...(serializedComments ? { userComments: serializedComments } : {}),
        ...(trimmedMessage ? { retranslateMessage: trimmedMessage } : {}),
        onToken: (text) => setRetranslateStreamingText(text),
        abortSignal: controller.signal,
      });

      // 완료 후 프로젝트 전환 여부 확인 (stale 방지)
      if (useProjectStore.getState().project?.id !== startProjectId) {
        setRetranslateError(t('review.retranslate.projectChanged', '재번역 중 프로젝트가 변경되었습니다. 결과가 폐기됩니다.'));
        return;
      }

      setRetranslatePreviewDoc(doc);
    } catch (error) {
      if (controller.signal.aborted) {
        setRetranslateError(t('review.retranslate.cancelled', '재번역이 취소되었습니다.'));
      } else {
        setRetranslateError(formatTranslationError(error));
      }
    } finally {
      setRetranslateLoading(false);
      // 본인 컨트롤러일 때만 해제 (이중 실행 가드의 기준값 보호)
      if (retranslateAbortController.current === controller) {
        retranslateAbortController.current = null;
      }
    }
  }, [getCheckedIssues, retranslateMessage, t]);

  const handleRetranslateCancel = useCallback(() => {
    if (retranslateAbortController.current) {
      retranslateAbortController.current.abort();
    }
    setRetranslateLoading(false);
  }, []);

  const handleRetranslateClose = useCallback(() => {
    setRetranslatePreviewOpen(false);
    setRetranslatePreviewDoc(null);
    setRetranslateOriginalDocJson(null);
    setRetranslateError(null);
    setRetranslateStreamingText('');
  }, []);

  /**
   * 재번역 결과(전체 또는 선택 병합본)를 에디터에 적용
   */
  const applyRetranslationDoc = useCallback((doc: TipTapDocJson) => {
    const { project, materializeBlocksForSnapshot } = useProjectStore.getState();
    if (!project) return;

    // TipTapDocJson을 HTML로 변환하여 target document에 적용.
    // JSON도 함께 갱신한다 — store의 targetDocument 교체는 에디터 content prop을 통해
    // 반영되면서 pending 동기화를 취소하므로, 여기서 안 넣으면 targetDocJson이 재번역
    // 이전 문서로 남아 AI 도구·정렬 뷰가 옛 내용을 본다.
    const html = tipTapJsonToHtml(doc);
    useProjectStore.getState().setTargetDocJson(doc);
    useProjectStore.getState().setTargetDocument(html);

    // 검수 결과 초기화
    resetReview();

    // 모달 닫기
    handleRetranslateClose();

    // 재번역 적용 후 자동 스냅샷
    const blocks = materializeBlocksForSnapshot();
    if (blocks) {
      const model = getModelIdForUse('translation');
      const dateLabel = new Date().toLocaleDateString('sv'); // YYYY-MM-DD
      const { createSnapshotIfChanged } = useHistoryStore.getState();
      void createSnapshotIfChanged({
        projectId: project.id,
        description: `${t('history.autoSnapshotAfterReviewApply')}(${model}) ${dateLabel}`,
        blocks,
      }).catch((err: unknown) => {
        console.warn('[history] auto snapshot after review apply failed:', err);
      });
    }

    // 결과 알림
    useUIStore.getState().addToast({
      type: 'success',
      message: t('review.retranslate.applied', '재번역이 적용되었습니다.'),
    });
  }, [resetReview, handleRetranslateClose, t]);

  const handleApplyRetranslation = useCallback(() => {
    if (!retranslatePreviewDoc) return;
    applyRetranslationDoc(retranslatePreviewDoc);
  }, [retranslatePreviewDoc, applyRetranslationDoc]);

  const handleReset = useCallback(() => {
    if (isReviewing) {
      handleCancel();
    }
    resetReview(); // 내부에서 하이라이트 비활성화 + nonce 증가 처리
  }, [isReviewing, handleCancel, resetReview]);

  // Memoize derived values to avoid recalculation on every render
  // (streamingText, elapsedSeconds 등 빈번한 상태 변경 시 불필요한 재계산 방지)
  const allIssues = useMemo(() => getAllIssues(), [results]); // results 변경 시 highlightNonce도 함께 변경됨 → store 캐시 무효화
  const checkedIssues = useMemo(
    () => allIssues.filter((issue) => issue.checked && severityFilter.includes(issue.severity)),
    [allIssues, severityFilter],
  );
  const hasErrors = useMemo(() => results.some((r) => r.error), [results]);
  const allChecked = useMemo(() => allIssues.length > 0 && allIssues.every((i) => i.checked), [allIssues]);

  return (
    <div className="h-full flex min-h-0 flex-col bg-editor-bg">
      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
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
          </div>
        ) : isReviewing ? (
          // 검수 진행 중 (결과 유무와 관계없이)
          <div className="space-y-4">
            {/* 상태 표시 영역 */}
            <div className="p-4 bg-editor-surface rounded-lg border border-editor-border space-y-3">
              {/* 헤더: 분석 중 텍스트 */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium shimmer-text">
                  {t('review.analyzing', '번역을 분석하고 있습니다...')}
                </span>
              </div>
              {/* 경과 시간 */}
              <span className="text-xs text-editor-muted tabular-nums">
                {t('review.elapsed', { seconds: elapsedSeconds })}
              </span>

              {/* 진행률 바 */}
              {progress.total > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-editor-muted mb-1">
                    <span>{progress.completed}/{progress.total} {t('review.chunks', '청크')}</span>
                    <span>{Math.round((progress.completed / progress.total) * 100)}%</span>
                  </div>
                  <div className="w-full h-2 bg-editor-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 transition-all duration-300"
                      style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 스트리밍 텍스트 (접이식) */}
              {streamingText && (
                <details className="group">
                  <summary className="text-xs text-editor-muted cursor-pointer hover:text-editor-text select-none">
                    {t('review.showResponse', 'AI 응답 보기')}
                  </summary>
                  <pre className="mt-2 p-2 bg-editor-bg rounded text-xs text-editor-muted overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
                    {streamingText}
                  </pre>
                </details>
              )}
            </div>

            {/* 실시간 결과 테이블 */}
            {results.length > 0 && (
              <>
                {hasErrors && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-500">
                    {t('review.hasErrors', '일부 청크에서 오류가 발생했습니다.')}
                  </div>
                )}
                <ReviewResultsTable
                  issues={allIssues}
                  onToggleCheck={toggleIssueCheck}
                  onDelete={deleteIssue}
                  onCopy={handleCopySuggestion}
                  onApply={handleApplySuggestion}
                  onViewInDocument={handleViewInDocument}
                  onToggleAll={() => setAllIssuesChecked(!allChecked)}
                  allChecked={allChecked}
                  totalIssuesFound={totalIssuesFound}
                  severityFilter={severityFilter}
                  onToggleSeverity={toggleSeverityFilter}
                />
              </>
            )}
          </div>
        ) : (
          // 검수 결과 표시
          <div className="space-y-4">
            {hasErrors && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-500">
                {t('review.hasErrors', '일부 청크에서 오류가 발생했습니다.')}
              </div>
            )}

            {/* 마지막 AI 응답 (접이식) - 검수 완료 후에도 확인 가능 */}
            {streamingText && (
              <details className="group">
                <summary className="text-xs text-editor-muted cursor-pointer hover:text-editor-text select-none">
                  {t('review.showResponse', 'AI 응답 보기')}
                </summary>
                <pre className="mt-2 p-2 bg-editor-surface rounded text-xs text-editor-muted overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all border border-editor-border">
                  {streamingText}
                </pre>
              </details>
            )}

            {checkedIssues.length > 0 && (
              <div className="p-3 bg-primary-500/5 border border-primary-500/20 rounded text-sm text-editor-text">
                <p className="text-xs text-editor-muted">
                  {t('review.retranslation.note', '선택한 이슈의 검수 결과를 반영하여 재번역합니다.')}
                </p>
              </div>
            )}

            <ReviewResultsTable
              issues={allIssues}
              onToggleCheck={toggleIssueCheck}
              onDelete={deleteIssue}
              onCopy={handleCopySuggestion}
              onApply={handleApplySuggestion}
              onToggleAll={() => setAllIssuesChecked(!allChecked)}
              allChecked={allChecked}
              totalIssuesFound={totalIssuesFound}
              severityFilter={severityFilter}
              onToggleSeverity={toggleSeverityFilter}
            />
          </div>
        )}
      </div>

      {/* 푸터 */}
      <div className="px-3 py-2 border-t border-editor-border shrink-0 flex items-center justify-between gap-3">
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
              {/* 재번역 버튼 (체크된 이슈가 있을 때만 표시) */}
              {checkedIssues.length > 0 && results.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetranslateClick}
                  disabled={retranslateLoading}
                  className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {t('review.retranslate.button', '재번역')}
                </button>
              )}
              {results.length > 0 && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-editor-border hover:bg-editor-bg transition-colors"
                >
                  {t('review.reset', '초기화')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleRunReview()}
                disabled={!project}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                data-testid="review-run-button"
              >
                {results.length > 0
                  ? t('review.restart', '다시 검수')
                  : t('review.start', '검수 시작')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 재번역 미리보기 모달 (기존 번역 diff UI 사용) */}
      <TranslatePreviewModal
        open={retranslatePreviewOpen}
        title={t('review.retranslate.preview', '재번역 미리보기')}
        docJson={retranslatePreviewDoc}
        sourceHtml={sourceDocument}
        originalHtml={targetDocument}
        isLoading={retranslateLoading}
        error={retranslateError}
        streamingText={retranslateStreamingText}
        originalDocJson={retranslateOriginalDocJson}
        onApplySelective={applyRetranslationDoc}
        onClose={handleRetranslateClose}
        onApply={handleApplyRetranslation}
        onCancel={handleRetranslateCancel}
        onRetry={handleRetranslateExecute}
      />

      {/* 재번역 중간 모달 (지시사항 입력) */}
      {retranslateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-editor-surface border border-editor-border rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-4 py-3 border-b border-editor-border">
              <h3 className="text-sm font-semibold text-editor-text">
                {t('review.retranslate.modal.title', '재번역 설정')}
              </h3>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-xs text-editor-muted mb-2">
                  {t('review.retranslate.modal.issueCount', '선택된 이슈: {{count}}개', { count: checkedIssues.length })}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-editor-text mb-1.5">
                  {t('review.retranslate.modal.messageLabel', '추가 지시사항')}
                  <span className="text-editor-muted font-normal ml-1">
                    {t('review.retranslate.modal.optional', '(선택)')}
                  </span>
                </label>
                <textarea
                  value={retranslateMessage}
                  onChange={(e) => setRetranslateMessage(e.target.value)}
                  placeholder={t('review.retranslate.modal.placeholder', '예: 전체적으로 더 격식체로 번역해주세요.')}
                  className="w-full h-24 px-3 py-2 text-sm bg-editor-bg border border-editor-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary-500 text-editor-text placeholder:text-editor-muted"
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-editor-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRetranslateModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-editor-border hover:bg-editor-bg transition-colors"
              >
                {t('common.cancel', '취소')}
              </button>
              <button
                type="button"
                onClick={handleRetranslateExecute}
                disabled={retranslateLoading}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {t('review.retranslate.modal.execute', '재번역 실행')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
