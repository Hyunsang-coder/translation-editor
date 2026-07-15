import { useTranslation } from 'react-i18next';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useEditorStore } from '@/stores/editorStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { TipTapMenuBar } from './TipTapMenuBar';
import { TranslatePreviewModal } from './TranslatePreviewModal';
import { SearchBar } from './SearchBar';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/react';
import {
  translateWithStreaming,
  formatTranslationError,
  type TipTapDocJson,
} from '@/ai/translateDocument';
import { polishTargetDocumentWithStreaming } from '@/ai/polishDocument';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { MODEL_PRESETS } from '@/ai/config';
import { Select, type SelectOptionGroup } from '@/components/ui/Select';
import { hashContent, stripHtml } from '@/utils/hash';
import { countTotalWords } from '@/utils/wordCounter';
import { resolveGlossaryForPrompt } from '@/utils/glossaryInject';
import { tipTapJsonToMarkdown, tipTapJsonToMarkdownForTranslation } from '@/utils/markdownConverter';
import { countWords, logQualityRun } from '@/quality';
import { getSelectionActionMenuHeight, SelectionActionMenu } from '@/components/ui/SelectionActionMenu';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';
import { NotebookPen, Sparkles, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { useCommentStore, type CommentField } from '@/stores/commentStore';
import { CommentInputPopover } from '@/components/comment/CommentInputPopover';
import { CommentDetailPopover } from '@/components/comment/CommentDetailPopover';
import { serializeUserComments } from '@/ai/commentContext';
import { collectCommentIdsInRange, removeCommentMark } from '@/editor/utils/commentNavigation';
import type { ITEProject } from '@/types';

/**
 * TipTap 기반 에디터 캔버스
 * Notion 스타일의 리치 텍스트 편집 환경
 */
function inferSegmentGroupIdForSelection(
  project: ITEProject | null,
  field: CommentField,
  selectedText: string,
): string | undefined {
  const needle = selectedText.trim();
  if (!project || !needle) return undefined;

  const matches: string[] = [];
  for (const segment of project.segments) {
    const blockIds = field === 'source' ? segment.sourceIds : segment.targetIds;
    const segmentText = blockIds
      .map((id) => stripHtml(project.blocks[id]?.content ?? ''))
      .join('\n');
    if (segmentText.includes(needle)) {
      matches.push(segment.groupId);
    }
  }

  return matches.length === 1 ? matches[0] : undefined;
}

export function EditorCanvasTipTap(): JSX.Element {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const sourceDocument = useProjectStore((s) => s.sourceDocument);
  const targetDocument = useProjectStore((s) => s.targetDocument);
  const setSourceDocument = useProjectStore((s) => s.setSourceDocument);
  const setTargetDocument = useProjectStore((s) => s.setTargetDocument);
  const setSourceDocJson = useProjectStore((s) => s.setSourceDocJson);
  const setTargetDocJson = useProjectStore((s) => s.setTargetDocJson);
  const setTargetLanguage = useProjectStore((s) => s.setTargetLanguage);

  const appendComposerText = useChatStore((s) => s.appendComposerText);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);
  const translationRules = useChatStore((s) => s.translationRules);
  const projectContext = useChatStore((s) => s.projectContext);

  const openReviewPanel = useUIStore((s) => s.openReviewPanel);
  const openCommentsPanel = useUIStore((s) => s.openCommentsPanel);
  const addToast = useUIStore((s) => s.addToast);
  const focusMode = useUIStore((s) => s.focusMode);
  const sourceOnlyMode = useUIStore((s) => s.sourceOnlyMode);
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);
  const toggleSourceOnlyMode = useUIStore((s) => s.toggleSourceOnlyMode);

  // 숨긴 사이드바 되살림 (에디터 헤더 양 끝) — 바 내부엔 UI가 없어 에디터 쪽에 노출.
  // 좌/우 모두 hidden뿐 아니라 panels 빈 상태(렌더 null)도 되살림 대상 (좌우 대칭).
  const leftSidebarInvisible = useUIStore((s) => s.leftSidebar.hidden || s.leftSidebar.panels.length === 0);
  const rightSidebarInvisible = useUIStore((s) => s.rightSidebar.hidden || s.rightSidebar.panels.length === 0);
  const revealLeftSidebar = useCallback(() => {
    const sb = useUIStore.getState().leftSidebar;
    if (sb.panels.length === 0) {
      useUIStore.getState().openPanelOnSide('left', 'settings');
    } else {
      useUIStore.getState().setSidebarHiddenSide('left', false);
    }
  }, []);
  const revealRightSidebar = useCallback(() => {
    // 숨겨진 채팅 패널이 이미 있으면 un-hide만 (빈 세션을 새로 만들지 않음).
    // panels가 비어 세울 게 없을 때만 openActiveChat이 세션을 생성/복구한다.
    const sb = useUIStore.getState().rightSidebar;
    if (sb.panels.length > 0) {
      useUIStore.getState().setSidebarHiddenSide('right', false);
    } else {
      useUIStore.getState().openActiveChat();
    }
  }, []);


  // Source/Target 패널별 폰트 설정
  const sourceFontSize = useUIStore((s) => s.sourceFontSize);
  const sourceLineHeight = useUIStore((s) => s.sourceLineHeight);
  const targetFontSize = useUIStore((s) => s.targetFontSize);
  const targetLineHeight = useUIStore((s) => s.targetLineHeight);

  const openaiEnabled = useAiConfigStore((s) => s.openaiEnabled);
  const anthropicEnabled = useAiConfigStore((s) => s.anthropicEnabled);
  const translationModel = useAiConfigStore((s) => s.translationModel);
  const setTranslationModel = useAiConfigStore((s) => s.setTranslationModel);

  const createSnapshotIfChanged = useHistoryStore((s) => s.createSnapshotIfChanged);

  const commentCount = useCommentStore((s) => s.comments.length);
  const comments = useCommentStore((s) => s.comments);

  // 활성화된 프로바이더의 모델만 표시
  const enabledPresets = useMemo((): SelectOptionGroup[] => {
    const presets: SelectOptionGroup[] = [];
    if (anthropicEnabled) {
      presets.push({
        label: 'Anthropic',
        options: MODEL_PRESETS.anthropic.map((m) => ({ value: m.value, label: m.label })),
      });
    }
    if (openaiEnabled) {
      presets.push({
        label: 'OpenAI',
        options: MODEL_PRESETS.openai.map((m) => ({ value: m.value, label: m.label })),
      });
    }
    return presets;
  }, [openaiEnabled, anthropicEnabled]);

  // 모든 모델 플랫 리스트 (유효성 검사용)
  const allTranslationModels = useMemo(() => {
    return enabledPresets.flatMap((g) => g.options);
  }, [enabledPresets]);

  // 선택된 모델이 비활성화된 프로바이더면 첫 번째 활성 모델로 변경
  useEffect(() => {
    if (allTranslationModels.length === 0) return;
    const firstModel = allTranslationModels[0];
    if (!firstModel) return;
    if (!allTranslationModels.some((m) => m.value === translationModel)) {
      setTranslationModel(firstModel.value);
    }
  }, [translationModel, allTranslationModels, setTranslationModel]);

  const sourceEditorRef = useRef<Editor | null>(null);
  const targetEditorRef = useRef<Editor | null>(null);
  const [sourceEditor, setSourceEditor] = useState<Editor | null>(null);
  const [targetEditor, setTargetEditor] = useState<Editor | null>(null);

  // 추가: Flash 효과 상태
  const [targetFlash, setTargetFlash] = useState(false);

  // 검색바 상태 (패널별 독립)
  const [sourceSearchOpen, setSourceSearchOpen] = useState(false);
  const [targetSearchOpen, setTargetSearchOpen] = useState(false);
  const [targetSearchReplaceMode, setTargetSearchReplaceMode] = useState(false);

  const [translatePreviewOpen, setTranslatePreviewOpen] = useState(false);
  const [translatePreviewDoc, setTranslatePreviewDoc] = useState<Record<string, unknown> | null>(null);
  const [translatePreviewError, setTranslatePreviewError] = useState<string | null>(null);
  const [translateLoading, setTranslateLoading] = useState(false);
  const translateAbortController = useRef<AbortController | null>(null);

  const [polishPreviewOpen, setPolishPreviewOpen] = useState(false);
  const [polishPreviewDoc, setPolishPreviewDoc] = useState<TipTapDocJson | null>(null);
  // 선택 적용 diff 기준: 폴리싱 시작 시점의 Target 문서 스냅샷
  const [polishOriginalDocJson, setPolishOriginalDocJson] = useState<TipTapDocJson | null>(null);
  const [polishPreviewError, setPolishPreviewError] = useState<string | null>(null);
  const [polishLoading, setPolishLoading] = useState(false);
  const polishAbortController = useRef<AbortController | null>(null);
  const [polishModalOpen, setPolishModalOpen] = useState(false);
  const [polishMessage, setPolishMessage] = useState('');

  // P4: 번역/폴리싱 스트리밍 텍스트는 캔버스 state가 아니라 translationPreviewStore 채널에
  // 기록한다(표시는 TranslatePreviewModal이 채널을 직접 구독). 델타마다 두 TipTap 에디터를
  // 포함한 캔버스 전체가 리렌더되는 것을 방지한다.
  const setStreamingChannelText = useCallback((channel: 'translate' | 'polish', text: string | null): void => {
    useTranslationPreviewStore.getState().setStreamingText(channel, text);
  }, []);

  // L2: 번역/폴리싱 요청 시작 시점의 프로젝트/Target 리비전 스냅샷.
  // EditorCanvasTipTap은 프로젝트 전환 시 remount되지 않으므로(아래 재등록 effect 주석 참조),
  // Apply 시점에 이 메타와 현재 상태를 재검증해 다른 프로젝트 문서에 적용되는 것을 막는다.
  interface PreviewRequestMeta {
    projectId: string;
    targetRevision: string | null;
  }
  const translateRequestMetaRef = useRef<PreviewRequestMeta | null>(null);
  const polishRequestMetaRef = useRef<PreviewRequestMeta | null>(null);

  // Target 문서 리비전: 살아있는 에디터 기준(store 캐시는 디바운스로 뒤처질 수 있음).
  // Desktop 브리지(oddeyesAppBridge)와 동일 산식(markdown 변환 후 hashContent).
  const computeTargetRevision = useCallback((): string | null => {
    const ed = targetEditorRef.current;
    if (!ed || ed.isDestroyed) return null;
    try {
      return hashContent(tipTapJsonToMarkdownForTranslation(ed.getJSON() as Record<string, unknown>));
    } catch {
      return null;
    }
  }, []);

  // 재번역 지시사항 모달 (타겟에 내용이 이미 있을 때)
  const [retranslateModalOpen, setRetranslateModalOpen] = useState(false);
  const [retranslateMessage, setRetranslateMessage] = useState('');

  // 검수 모달 상태는 더 이상 사용하지 않음 (Review 탭으로 대체)

  const [addToChatBubble, setAddToChatBubble] = useState<null | {
    top: number;
    left: number;
    text: string;
    editor: Editor;
    field: CommentField;
    from: number;
    to: number;
    segmentGroupId: string | undefined;
    existingComments: Array<{ id: string; excerpt: string }>;
  }>(null);

  // 코멘트 입력 popover 상태
  const [commentPopover, setCommentPopover] = useState<null | {
    top: number;
    left: number;
    excerpt: string;
    editor: Editor;
    field: CommentField;
    from: number;
    to: number;
    segmentGroupId: string | undefined;
  }>(null);

  // 코멘트 상세 popover 상태 (마크 클릭 / 선택 메뉴)
  const [commentDetailPopover, setCommentDetailPopover] = useState<null | {
    top: number;
    left: number;
    commentId: string;
    editor: Editor;
    field: CommentField;
  }>(null);

  // 단어 수 계산 (debounced: 매 변경마다 stripHtml 재계산 방지)
  const [sourceWordCount, setSourceWordCount] = useState(0);
  const [targetWordCount, setTargetWordCount] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!sourceDocument) { setSourceWordCount(0); return; }
      setSourceWordCount(countTotalWords(sourceDocument));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [sourceDocument]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!targetDocument) { setTargetWordCount(0); return; }
      setTargetWordCount(countTotalWords(targetDocument));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [targetDocument]);

  // 선택 영역에서 우클릭하면 액션 메뉴를 마우스 위치에 띄운다.
  // (선택이 없으면 커스텀 메뉴를 띄우지 않고 OS/브라우저 기본 메뉴를 그대로 둔다.)
  const openSelectionActionMenuAt = useCallback((
    editor: Editor,
    field: CommentField,
    clientX: number,
    clientY: number,
  ): boolean => {
    const { from, to } = editor.state.selection;
    if (from === to) return false;

    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!selectedText) return false;

    // 선택 범위가 속한 블록의 segmentGroupId 추출(중복 구절 모호성 완화)
    let segmentGroupId: string | undefined;
    try {
      const resolved = editor.state.doc.resolve(from);
      for (let depth = resolved.depth; depth >= 0; depth--) {
        const sg = resolved.node(depth).attrs?.segmentGroupId;
        if (typeof sg === 'string' && sg) {
          segmentGroupId = sg;
          break;
        }
      }
    } catch {
      // ignore
    }
    if (!segmentGroupId) {
      segmentGroupId = inferSegmentGroupIdForSelection(project, field, selectedText);
    }

    try {
      const commentIds = collectCommentIdsInRange(editor.state.doc, from, to);
      const store = useCommentStore.getState();
      const existingComments = commentIds.flatMap((id) => {
        const comment = store.getComment(id);
        return comment ? [{ id: comment.id, excerpt: comment.excerpt }] : [];
      });

      // 마우스 우클릭 위치에 메뉴를 띄우되 화면 경계 안으로 클램프한다.
      // 아래로 넘치면 커서 위쪽으로 올려 잘리지 않게 한다.
      const menuHeight = getSelectionActionMenuHeight(existingComments.length);
      const left = Math.min(window.innerWidth - 200, Math.max(8, clientX));
      const top = clientY + menuHeight > window.innerHeight - 8
        ? Math.max(8, clientY - menuHeight)
        : clientY;

      setCommentDetailPopover(null);
      setAddToChatBubble({
        top,
        left,
        text: selectedText,
        editor,
        field,
        from,
        to,
        segmentGroupId,
        existingComments,
      });
      return true;
    } catch {
      return false;
    }
  }, [project]);

  const attachSelectionWatcher = useCallback((editor: Editor, field: CommentField) => {
    const dom = editor.view.dom as HTMLElement;

    // 선택 영역에서 우클릭 → 액션 메뉴. 선택이 없으면 기본 메뉴 유지.
    const onContextMenu = (e: MouseEvent): void => {
      const opened = openSelectionActionMenuAt(editor, field, e.clientX, e.clientY);
      if (opened) e.preventDefault();
    };
    // 선택이 열린 메뉴의 범위와 달라지면(다시 클릭/드래그) 메뉴를 닫는다.
    // 우클릭 순간의 selectionUpdate는 같은 범위이므로 방금 연 메뉴를 닫지 않는다.
    const onSelection = (): void => {
      const { from, to } = editor.state.selection;
      setAddToChatBubble((prev) => {
        if (!prev || prev.editor !== editor) return prev;
        return prev.from === from && prev.to === to ? prev : null;
      });
    };
    const onBlur = (): void => {
      setAddToChatBubble(null);
    };

    dom.addEventListener('contextmenu', onContextMenu);
    editor.on('selectionUpdate', onSelection);
    editor.on('blur', onBlur);

    return () => {
      dom.removeEventListener('contextmenu', onContextMenu);
      editor.off('selectionUpdate', onSelection);
      editor.off('blur', onBlur);
    };
  }, [openSelectionActionMenuAt]);

  // 메뉴만 닫기 (닫기 버튼 / 메뉴 바깥 클릭). 선택 영역은 그대로 유지한다.
  const dismissAddToChatBubble = useCallback((): void => {
    setAddToChatBubble(null);
  }, []);

  const openCommentDetail = useCallback((params: {
    commentId: string;
    editor: Editor;
    field: CommentField;
    top: number;
    left: number;
  }): void => {
    setAddToChatBubble(null);
    setCommentPopover(null);
    setCommentDetailPopover(params);
  }, []);

  const handleSourceCommentClick = useCallback((payload: { commentId: string; top: number; left: number }) => {
    const editor = sourceEditorRef.current;
    if (!editor) return;
    openCommentDetail({ ...payload, editor, field: 'source' });
  }, [openCommentDetail]);

  const handleTargetCommentClick = useCallback((payload: { commentId: string; top: number; left: number }) => {
    const editor = targetEditorRef.current;
    if (!editor) return;
    openCommentDetail({ ...payload, editor, field: 'target' });
  }, [openCommentDetail]);

  const handleUpdateComment = useCallback((commentId: string, text: string): void => {
    useCommentStore.getState().updateComment(commentId, { comment: text });
    void useProjectStore.getState().saveProject();
  }, []);

  const handleToggleCommentResolve = useCallback((commentId: string): void => {
    const comment = useCommentStore.getState().getComment(commentId);
    if (!comment) return;
    useCommentStore.getState().resolveComment(commentId, !comment.resolved);
    void useProjectStore.getState().saveProject();
  }, []);

  const handleDeleteComment = useCallback((commentId: string, editor: Editor): void => {
    removeCommentMark(editor, commentId);
    useCommentStore.getState().removeComment(commentId);
    setCommentDetailPopover(null);
    void useProjectStore.getState().saveProject();
  }, []);

  const closeCommentDetail = useCallback((): void => {
    setCommentDetailPopover(null);
  }, []);

  // 선택 범위에 코멘트 추가: 마크 적용 + commentStore 저장
  const handleSaveComment = useCallback(
    (
      ctx: {
        editor: Editor;
        field: CommentField;
        from: number;
        to: number;
        excerpt: string;
        segmentGroupId: string | undefined;
      },
      commentText: string,
    ): void => {
      const trimmed = commentText.trim();
      if (!trimmed) return;

      const created = useCommentStore.getState().addComment({
        field: ctx.field,
        excerpt: ctx.excerpt,
        comment: trimmed,
        ...(ctx.segmentGroupId ? { segmentGroupId: ctx.segmentGroupId } : {}),
      });

      // 선택 범위에 commentId 마크 적용
      // (에디터 onUpdate → setTarget/SourceDocument → write-through 저장으로 마크가 영속됨)
      ctx.editor
        .chain()
        .focus()
        .setTextSelection({ from: ctx.from, to: ctx.to })
        .setComment(created.id)
        .run();

      // 코멘트 본문 영속(프로젝트 저장 경로에서 commentStore를 함께 저장)
      void useProjectStore.getState().saveProject();

      setCommentPopover(null);
    },
    [],
  );

  const openTranslatePreview = useCallback(async (extraMessage?: string): Promise<void> => {
    if (!project) return;
    if (!sourceEditorRef.current) {
      addToast({ type: 'error', message: t('editor.sourceEditorNotReady', 'Source 에디터가 아직 준비되지 않았습니다.') });
      return;
    }

    if (!project.metadata.targetLanguage) {
      addToast({ type: 'warning', message: t('editor.selectTargetLanguage', '타겟 언어를 선택하세요.') });
      return;
    }

    // 빈 문서 검증: 텍스트 콘텐츠가 없으면 번역 불필요
    if (sourceEditorRef.current.isEmpty) {
      addToast({ type: 'warning', message: t('editor.emptySource', '번역할 원문이 없습니다. 원문을 먼저 입력해주세요.') });
      return;
    }

    setTranslatePreviewError(null);
    setTranslatePreviewDoc(null);
    setTranslatePreviewOpen(true);
    setTranslateLoading(true);
    setStreamingChannelText('translate', null);

    // L2: 요청 시작 시점의 프로젝트/Target 리비전 캡처 (Apply 시 재검증)
    const requestMeta = {
      projectId: project.id,
      targetRevision: computeTargetRevision(),
    };
    translateRequestMetaRef.current = requestMeta;

    // AbortController 생성
    const abortController = new AbortController();
    translateAbortController.current = abortController;

    try {
      const sourceDocJson = sourceEditorRef.current.getJSON() as Record<string, unknown>;

      // 용어집 검색 (앞부분만이 아니라 문서 전역 윈도우)
      let glossary = '';
      try {
        const sourceMarkdown = tipTapJsonToMarkdown(sourceDocJson);
        if (sourceMarkdown.trim().length > 0) {
          glossary = await resolveGlossaryForPrompt({
            projectId: project.id,
            text: sourceMarkdown,
            domain: project.metadata.domain,
            limit: 30,
          });
          if (glossary) {
            console.warn(`[Translation] Glossary injected`);
          }
        }
      } catch (glossaryError) {
        // 용어집 검색 실패는 조용히 무시 (번역은 계속 진행)
        console.warn('[Translation] Glossary search failed:', glossaryError);
      }

      const trimmedMessage = extraMessage?.trim();
      // 인라인 코멘트 → excerpt 직렬화 후 주입 (source/target 양쪽 모두 번역 맥락으로 전달)
      const serializedComments = serializeUserComments(
        useCommentStore.getState().comments,
      );
      const { doc } = await translateWithStreaming({
        project,
        sourceDocJson,
        translationRules,
        projectContext,
        glossary,
        ...(serializedComments ? { userComments: serializedComments } : {}),
        ...(trimmedMessage ? { retranslateMessage: trimmedMessage } : {}),
        onToken: (text) => {
          setStreamingChannelText('translate', text);
        },
        abortSignal: abortController.signal,
      });
      // L2: 완료 시점 재검증 — 취소되었거나(프로젝트 전환 effect의 abort 포함),
      // 이 요청이 더 이상 활성 요청이 아니거나, 프로젝트가 바뀌었으면 결과를 버린다.
      if (abortController.signal.aborted) return;
      if (translateAbortController.current !== abortController) return;
      if (useProjectStore.getState().project?.id !== requestMeta.projectId) return;
      setTranslatePreviewDoc(doc);
      setStreamingChannelText('translate', null); // 완료 후 스트리밍 텍스트 초기화
    } catch (e) {
      // stale 요청(그 사이 새 요청 시작)이 새 요청의 상태를 덮지 않도록 가드
      if (translateAbortController.current !== abortController) return;
      // 취소된 경우
      if (abortController.signal.aborted) {
        setTranslatePreviewError('번역이 취소되었습니다.');
      } else {
        console.error('[Translation] preview failed:', e);
        setTranslatePreviewError(formatTranslationError(e));
      }
    } finally {
      // 소유권 확인 후에만 정리 (stale 요청의 finally가 새 요청 상태를 파괴하지 않도록)
      if (translateAbortController.current === abortController) {
        setTranslateLoading(false);
        translateAbortController.current = null;
      }
    }
  }, [
    project,
    translationRules,
    projectContext,
    addToast,
    t,
    computeTargetRevision,
    setStreamingChannelText,
  ]);

  // 번역 버튼 클릭 핸들러: 타겟에 내용이 있으면 재번역 모달 먼저 표시
  const handleTranslateClick = useCallback(() => {
    if (!sourceEditorRef.current) return;
    const hasTarget = stripHtml(targetDocument || '').trim().length > 0;
    if (hasTarget) {
      setRetranslateMessage('');
      setRetranslateModalOpen(true);
    } else {
      void openTranslatePreview();
    }
  }, [targetDocument, openTranslatePreview]);

  const hasTargetContent = useMemo(
    () => stripHtml(targetDocument || '').trim().length > 0,
    [targetDocument],
  );

  const openPolishPreview = useCallback(async (extraMessage?: string): Promise<void> => {
    if (!project) return;

    if (!hasTargetContent) {
      addToast({
        type: 'warning',
        message: t('review.emptyTarget', '번역문이 비어있습니다. 번역을 먼저 실행해주세요.'),
      });
      return;
    }

    if (!targetEditorRef.current) {
      addToast({ type: 'error', message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.') });
      return;
    }

    setPolishPreviewError(null);
    setPolishPreviewDoc(null);
    setPolishPreviewOpen(true);
    setPolishLoading(true);
    setStreamingChannelText('polish', null);

    // L2: 요청 시작 시점의 프로젝트/Target 리비전 캡처 (Apply 시 재검증)
    const requestMeta = {
      projectId: project.id,
      targetRevision: computeTargetRevision(),
    };
    polishRequestMetaRef.current = requestMeta;

    const abortController = new AbortController();
    polishAbortController.current = abortController;

    try {
      const targetDocJson = targetEditorRef.current.getJSON() as TipTapDocJson;
      setPolishOriginalDocJson(targetDocJson);
      // 폴리싱은 target 문서만 다루므로 target field 코멘트만 주입
      const serializedComments = serializeUserComments(
        useCommentStore.getState().comments,
        {
          field: 'target',
          leadIn: '아래는 번역가가 특정 구절에 남긴 코멘트입니다. 다듬을 때 반드시 반영하세요:',
        },
      );
      const trimmedMessage = extraMessage?.trim();

      // Source(+Target)에서 용어 검색 — Target만 검색하면 원문 용어가 안 잡힘
      let glossary = '';
      try {
        const sourceMarkdown = sourceEditorRef.current
          ? tipTapJsonToMarkdown(sourceEditorRef.current.getJSON() as Record<string, unknown>)
          : '';
        const targetMarkdown = tipTapJsonToMarkdown(targetDocJson as Record<string, unknown>);
        const searchText = [sourceMarkdown, targetMarkdown].filter((part) => part.trim()).join('\n');
        if (searchText.trim().length > 0) {
          glossary = await resolveGlossaryForPrompt({
            projectId: project.id,
            text: searchText,
            domain: project.metadata.domain,
            limit: 30,
          });
        }
      } catch (glossaryError) {
        console.warn('[Polish] Glossary search failed:', glossaryError);
      }

      const { doc } = await polishTargetDocumentWithStreaming({
        targetDocJson,
        targetLanguage: project.metadata.targetLanguage,
        styleRules: translationRules,
        projectContext,
        ...(glossary ? { glossary } : {}),
        ...(serializedComments ? { userComments: serializedComments } : {}),
        ...(trimmedMessage ? { polishMessage: trimmedMessage } : {}),
        onToken: (text) => setStreamingChannelText('polish', text),
        abortSignal: abortController.signal,
      });
      // L2: 완료 시점 재검증 (취소/전환/새 요청 시작 시 결과 폐기)
      if (abortController.signal.aborted) return;
      if (polishAbortController.current !== abortController) return;
      if (useProjectStore.getState().project?.id !== requestMeta.projectId) return;
      setPolishPreviewDoc(doc);
      setStreamingChannelText('polish', null);
    } catch (error) {
      // stale 요청이 새 요청의 상태를 덮지 않도록 가드
      if (polishAbortController.current !== abortController) return;
      if (abortController.signal.aborted) {
        setPolishPreviewError(t('editor.polishCancelled', '폴리싱이 취소되었습니다.'));
      } else {
        setPolishPreviewError(formatTranslationError(error));
      }
    } finally {
      if (polishAbortController.current === abortController) {
        setPolishLoading(false);
        polishAbortController.current = null;
      }
    }
  }, [addToast, hasTargetContent, project, t, translationRules, projectContext, computeTargetRevision, setStreamingChannelText]);

  const handlePolishClick = useCallback(() => {
    if (!project) return;
    if (!hasTargetContent) {
      addToast({
        type: 'warning',
        message: t('review.emptyTarget', '번역문이 비어있습니다. 번역을 먼저 실행해주세요.'),
      });
      return;
    }
    if (!targetEditorRef.current) {
      addToast({ type: 'error', message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.') });
      return;
    }
    setPolishMessage('');
    setPolishModalOpen(true);
  }, [addToast, hasTargetContent, project, t]);

  // 번역 취소 핸들러
  const handleTranslateCancel = useCallback((): void => {
    if (translateAbortController.current) {
      translateAbortController.current.abort();
    }
    setTranslateLoading(false);
    setTranslatePreviewOpen(false);
    setStreamingChannelText('translate', null);
  }, [setStreamingChannelText]);

  const applyTranslatePreview = useCallback((): void => {
    if (!translatePreviewDoc) return;
    if (!targetEditorRef.current) {
      addToast({ type: 'error', message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.') });
      return;
    }

    // L2 가드 ①: 요청 시점 프로젝트와 현재 프로젝트가 다르면 적용 금지.
    // (프로젝트 전환 effect가 모달을 닫지만, 전환 경합/모달 잔존 케이스의 최종 방어선)
    const meta = translateRequestMetaRef.current;
    const currentProjectId = useProjectStore.getState().project?.id ?? null;
    if (!meta || !currentProjectId || meta.projectId !== currentProjectId) {
      addToast({
        type: 'warning',
        message: t('editor.applyCancelledProjectSwitched', '프로젝트가 전환되어 적용을 취소했습니다.'),
      });
      setTranslatePreviewOpen(false);
      setTranslatePreviewDoc(null);
      return;
    }

    // L2 가드 ②: 같은 프로젝트라도 요청 이후 Target이 수정되었으면 적용을 중단한다.
    // NOTE(제품 결정 필요, 코드리뷰 2026-07-07 §7): "요청 후 사용자 편집" 충돌을
    // 하드 차단할지 경고 후 강제 적용할지 미정 — 보수적 기본값으로 경고 토스트 + 중단.
    const currentRevision = computeTargetRevision();
    // 요청 시점 리비전을 캡처했는데(=meta.targetRevision !== null) 현재 리비전을
    // 계산하지 못하면(에디터 파괴/변환 예외로 null), "변경 없음"을 확신할 수 없다.
    // 이 경우 가드를 통째로 건너뛰면 stale 번역이 사용자 편집을 소리 없이 덮으므로,
    // 보수적으로 적용을 중단한다(§검증 불가 → 차단).
    if (meta.targetRevision !== null && meta.targetRevision !== currentRevision) {
      addToast({
        type: 'warning',
        message: t('editor.applyCancelledDocChanged', '번역 요청 이후 문서가 수정되어 적용을 취소했습니다. 문서를 확인한 뒤 다시 실행해주세요.'),
      });
      return;
    }

    // replaceDocContent는 onUpdate를 발동시키므로 store 자동 동기화됨
    // addToHistory: true → Ctrl+Z로 번역 취소 가능
    replaceDocContent(targetEditorRef.current, translatePreviewDoc, { addToHistory: true });
    setTranslatePreviewOpen(false);

    // Flash 효과 트리거 (1초 동안 지속)
    setTargetFlash(true);
    setTimeout(() => setTargetFlash(false), 1000);

    // 번역 적용 후 자동 스냅샷
    const { project, materializeBlocksForSnapshot } = useProjectStore.getState();
    if (project) {
      const blocks = materializeBlocksForSnapshot();
      if (blocks) {
        const model = useAiConfigStore.getState().translationModel;
        const dateLabel = new Date().toLocaleDateString('sv'); // YYYY-MM-DD
        void createSnapshotIfChanged({
          projectId: project.id,
          description: `${t('history.autoSnapshotAfterTranslate')}(${model}) ${dateLabel}`,
          blocks,
        }).catch((err: unknown) => {
          console.warn('[history] auto snapshot after translate failed:', err);
        });
      }
      // 여기의 fresh project.id는 위 L2 가드 ①에 의해 요청 시점 프로젝트와 동일함이 보장된다.
      // 품질 장부: 번역 적용을 quality_run으로 기록 (best-effort, WP-A1 요구사항 2)
      void logQualityRun(project.id, {
        stage: 's1_translate',
        executor: 'app',
        model: useAiConfigStore.getState().translationModel,
        direction: null,
        route_id: null,
        doc_words: countWords(targetEditorRef.current?.getText() ?? ''),
        findings_count: null,
        notes: 'applied',
      });
    }
  }, [translatePreviewDoc, addToast, t, createSnapshotIfChanged, computeTargetRevision]);

  const handlePolishCancel = useCallback((): void => {
    if (polishAbortController.current) {
      polishAbortController.current.abort();
    }
    setPolishLoading(false);
    setPolishPreviewOpen(false);
    setStreamingChannelText('polish', null);
  }, [setStreamingChannelText]);

  // 폴리싱 미리보기 종료 시 스냅샷 상태를 함께 정리 (ReviewPanel handleRetranslateClose와 대칭).
  // 재열기 경로가 항상 재스냅샷하므로 correctness 이슈는 아니지만, 문서 JSON 상주를 방지한다.
  const handlePolishClose = useCallback((): void => {
    setPolishPreviewOpen(false);
    setPolishPreviewDoc(null);
    setPolishOriginalDocJson(null);
    setPolishPreviewError(null);
    setStreamingChannelText('polish', null);
  }, [setStreamingChannelText]);

  const applyPolishDoc = useCallback((doc: TipTapDocJson): void => {
    if (!targetEditorRef.current) {
      addToast({ type: 'error', message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.') });
      return;
    }

    // L2 가드 ①: 요청 시점 프로젝트와 현재 프로젝트가 다르면 적용 금지.
    const meta = polishRequestMetaRef.current;
    const currentProjectId = useProjectStore.getState().project?.id ?? null;
    if (!meta || !currentProjectId || meta.projectId !== currentProjectId) {
      addToast({
        type: 'warning',
        message: t('editor.applyCancelledProjectSwitched', '프로젝트가 전환되어 적용을 취소했습니다.'),
      });
      handlePolishClose();
      return;
    }

    // L2 가드 ②: 요청 이후 Target이 수정되었으면 적용 중단 (사용자 편집 유실 방지).
    // NOTE(제품 결정 필요, 코드리뷰 2026-07-07 §7): 하드 차단 vs 경고 후 강제 적용 —
    // 보수적 기본값으로 경고 토스트 + 중단. (선택 적용 병합도 요청 시점 스냅샷 기준이므로
    // 편집 후 적용하면 편집분이 소리 없이 사라진다)
    const currentRevision = computeTargetRevision();
    // 요청 시점 리비전을 캡처했는데 현재 리비전을 계산하지 못하면(null) 변경 여부를
    // 확신할 수 없으므로, 가드를 건너뛰지 않고 보수적으로 중단한다(F4). 선택 적용
    // 병합도 요청 시점 스냅샷 기준이라 검증 실패 시 편집분이 소리 없이 사라진다.
    if (meta.targetRevision !== null && meta.targetRevision !== currentRevision) {
      addToast({
        type: 'warning',
        message: t('editor.applyCancelledDocChanged', '번역 요청 이후 문서가 수정되어 적용을 취소했습니다. 문서를 확인한 뒤 다시 실행해주세요.'),
      });
      return;
    }

    replaceDocContent(targetEditorRef.current, doc, { addToHistory: true });
    handlePolishClose();

    setTargetFlash(true);
    setTimeout(() => setTargetFlash(false), 1000);

    const { project, materializeBlocksForSnapshot } = useProjectStore.getState();
    if (project) {
      const blocks = materializeBlocksForSnapshot();
      if (blocks) {
        const model = useAiConfigStore.getState().translationModel;
        const dateLabel = new Date().toLocaleDateString('sv');
        void createSnapshotIfChanged({
          projectId: project.id,
          description: `${t('history.autoSnapshotAfterPolish')}(${model}) ${dateLabel}`,
          blocks,
        }).catch((err: unknown) => {
          console.warn('[history] auto snapshot after polish failed:', err);
        });
      }
      // 품질 장부: 폴리싱 적용을 quality_run으로 기록 (best-effort, WP-A1 요구사항 2)
      void logQualityRun(project.id, {
        stage: 's2_polish',
        executor: 'app',
        model: useAiConfigStore.getState().translationModel,
        direction: null,
        route_id: null,
        doc_words: countWords(targetEditorRef.current?.getText() ?? ''),
        findings_count: null,
        notes: 'applied',
      });
    }
  }, [addToast, t, createSnapshotIfChanged, handlePolishClose, computeTargetRevision]);

  const applyPolishPreview = useCallback((): void => {
    if (!polishPreviewDoc) return;
    applyPolishDoc(polishPreviewDoc);
  }, [polishPreviewDoc, applyPolishDoc]);

  // 번역 재시도 핸들러
  const handleTranslateRetry = useCallback((): void => {
    void openTranslatePreview(retranslateMessage);
  }, [openTranslatePreview, retranslateMessage]);

  const handlePolishRetry = useCallback((): void => {
    void openPolishPreview(polishMessage);
  }, [openPolishPreview, polishMessage]);

  // Source 에디터 준비 완료 콜백
  const handleSourceEditorReady = useCallback((editor: Editor) => {
    sourceEditorRef.current = editor;
    setSourceEditor(editor);
    useEditorStore.getState().setSourceEditor(editor);
  }, []);

  // Target 에디터 준비 완료 콜백
  const handleTargetEditorReady = useCallback((editor: Editor) => {
    targetEditorRef.current = editor;
    setTargetEditor(editor);
    useEditorStore.getState().setTargetEditor(editor);
  }, []);

  // 에디터 unmount/재생성 시 editorStore에서 stale 참조 정리
  useEffect(() => {
    return () => {
      useEditorStore.getState().clearEditors();
    };
  }, []);

  // 프로젝트 전환 시 projectStore.switchProjectById가 clearEditors()로 스토어를 비우지만,
  // EditorCanvasTipTap은 프로젝트로 remount되지 않아(내용 prop만 교체) 에디터 인스턴스가
  // 재사용된다. 그 결과 onEditorReady가 다시 호출되지 않아 스토어가 null로 남고,
  // 검수 적용 등 store.targetEditor를 읽는 기능이 "에디터 준비 안 됨"으로 실패한다.
  // 프로젝트가 바뀔 때마다 살아있는 에디터를 스토어에 다시 등록해 이를 방지한다.
  useEffect(() => {
    const store = useEditorStore.getState();
    if (sourceEditor && !sourceEditor.isDestroyed) store.setSourceEditor(sourceEditor);
    if (targetEditor && !targetEditor.isDestroyed) store.setTargetEditor(targetEditor);
  }, [project?.id, sourceEditor, targetEditor]);

  // L2: 프로젝트 전환 시 진행 중인 번역/폴리싱 요청과 열린 프리뷰 모달을 정리한다.
  // 이 컴포넌트는 프로젝트로 remount되지 않으므로(위 재등록 effect 주석 참조), 여기서
  // 직접 abort + close하지 않으면 A 프로젝트의 번역이 B 프로젝트 위에 표시/적용될 수 있다.
  // (마운트 첫 실행 시에는 모두 초기 상태라 no-op)
  useEffect(() => {
    translateAbortController.current?.abort();
    polishAbortController.current?.abort();
    translateRequestMetaRef.current = null;
    polishRequestMetaRef.current = null;
    setTranslatePreviewOpen(false);
    setTranslatePreviewDoc(null);
    setTranslatePreviewError(null);
    setTranslateLoading(false);
    setPolishPreviewOpen(false);
    setPolishPreviewDoc(null);
    setPolishOriginalDocJson(null);
    setPolishPreviewError(null);
    setPolishLoading(false);
    setStreamingChannelText('translate', null);
    setStreamingChannelText('polish', null);
  }, [project?.id, setStreamingChannelText]);

  // 검색바 핸들러
  const handleSourceSearchOpen = useCallback(() => {
    setSourceSearchOpen((prev) => !prev);
  }, []);

  const handleSourceSearchClose = useCallback(() => {
    setSourceSearchOpen(false);
  }, []);

  const handleTargetSearchOpen = useCallback(() => {
    setTargetSearchReplaceMode(false);
    setTargetSearchOpen((prev) => !prev);
  }, []);

  const handleTargetSearchOpenWithReplace = useCallback(() => {
    setTargetSearchReplaceMode(true);
    setTargetSearchOpen(true);
  }, []);

  const handleTargetSearchClose = useCallback(() => {
    setTargetSearchOpen(false);
    setTargetSearchReplaceMode(false);
  }, []);

  // 패널 복사 핸들러 (text/html + text/plain 둘 다 클립보드에 저장)
  const copyEditorContent = useCallback(async (editor: Editor | null) => {
    if (!editor || editor.isEmpty) {
      addToast({ type: 'error', message: t('common.copyError', '복사할 내용이 없습니다.') });
      return;
    }
    try {
      const html = editor.getHTML();
      const markdown = tipTapJsonToMarkdownForTranslation(editor.getJSON() as Record<string, unknown>);
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([markdown], { type: 'text/plain' }),
        }),
      ]);
      addToast({ type: 'success', message: t('common.copied', '클립보드에 복사되었습니다.') });
    } catch {
      addToast({ type: 'error', message: t('common.copyError', '복사에 실패했습니다.') });
    }
  }, [addToast, t]);

  const handleCopySource = useCallback(() => copyEditorContent(sourceEditorRef.current), [copyEditorContent]);
  const handleCopyTarget = useCallback(() => copyEditorContent(targetEditorRef.current), [copyEditorContent]);

  // Source/Target 중 포커스된 에디터의 selection watcher를 연결
  useEffect(() => {
    const cleaners: Array<() => void> = [];
    if (sourceEditor) cleaners.push(attachSelectionWatcher(sourceEditor, 'source'));
    if (targetEditor) cleaners.push(attachSelectionWatcher(targetEditor, 'target'));
    return () => {
      cleaners.forEach((fn) => fn());
    };
  }, [sourceEditor, targetEditor, attachSelectionWatcher]);

  // 선택 액션 메뉴가 열려 있을 때, 메뉴 바깥(에디터 밖 여백/다른 UI)을 클릭하면
  // 메뉴만 닫고 선택 영역은 유지한다. 에디터 본문 클릭은 selectionUpdate가 처리한다.
  useEffect(() => {
    if (!addToChatBubble) return;
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-selection-action-menu]')) return;
      dismissAddToChatBubble();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [addToChatBubble, dismissAddToChatBubble]);

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-editor-muted">
        {t('editor.loadingProject')}
      </div>
    );
  }

  const activeDetailComment = commentDetailPopover
    ? comments.find((c) => c.id === commentDetailPopover.commentId)
    : undefined;

  const showSource = !focusMode;
  const showTarget = !sourceOnlyMode;
  const showSplitHandle = showSource && showTarget;

  return (
    <div className="flex-1 h-full min-h-0 flex flex-col min-w-0 bg-editor-surface">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-editor-border shrink-0">
        <div className="flex items-center gap-2">
          {leftSidebarInvisible && (
            <button
              type="button"
              onClick={revealLeftSidebar}
              className="p-1.5 -ml-1.5 rounded-md text-editor-muted hover:text-editor-text hover:bg-editor-border transition-colors"
              title={t('sidebar.showLeft', 'Show side panel')}
              aria-label={t('sidebar.showLeft', 'Show side panel')}
              data-testid="reveal-sidebar-left"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
          <span className="text-xs font-bold text-editor-text tracking-wide">{t('editor.editorLabel')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={translationModel}
            onChange={setTranslationModel}
            options={enabledPresets}
            aria-label={t('editor.translationModelAriaLabel')}
            title={t('editor.translationModel')}
            size="sm"
            className="min-w-[130px]"
          />
          {/* AI 작업 워크플로 (번역 → 검수 → 폴리싱) — segmented control */}
          <div className="inline-flex items-stretch rounded-md border border-editor-border overflow-hidden bg-editor-bg">
            <button
              type="button"
              onClick={handleTranslateClick}
              className="px-2.5 py-1 text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 flex items-center gap-1 disabled:opacity-60 transition-colors"
              disabled={translateLoading}
              title={t('editor.translateTitle')}
              data-testid="editor-translate-button"
            >
              {translateLoading ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{t('editor.translating')}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t('editor.translate')}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => openReviewPanel()}
              className="px-2.5 py-1 text-xs font-semibold text-editor-text border-l border-editor-border hover:bg-editor-surface transition-colors"
              title={t('editor.reviewTitle', '번역 검수')}
              data-testid="editor-review-button"
            >
              {t('editor.review', '검수')}
            </button>
            <button
              type="button"
              onClick={handlePolishClick}
              className="px-2.5 py-1 text-xs font-semibold text-editor-text border-l border-editor-border hover:bg-editor-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              disabled={!hasTargetContent || polishLoading}
              title={t('review.polish', '폴리싱')}
              data-testid="editor-polish-button"
            >
              {t('review.polish', '폴리싱')}
            </button>
          </div>
          {/* 코멘트 — 워크플로와 분리된 유틸리티 */}
          <button
            type="button"
            onClick={() => openCommentsPanel()}
            className="p-1.5 rounded-md text-editor-muted hover:text-editor-text hover:bg-editor-border flex items-center gap-1 transition-colors relative"
            title={t('comment.title', '코멘트')}
            data-testid="editor-comments-button"
          >
            <NotebookPen className="w-4 h-4" />
            {commentCount > 0 && (
              <span className="tabular-nums text-[11px] font-semibold text-editor-text">{commentCount}</span>
            )}
          </button>
          {/* 숨긴 채팅 바 되살림 */}
          {rightSidebarInvisible && (
            <button
              type="button"
              onClick={revealRightSidebar}
              className="p-1.5 -mr-1.5 rounded-md text-editor-muted hover:text-editor-text hover:bg-editor-border transition-colors"
              title={t('sidebar.showRight', 'Show chat panel')}
              aria-label={t('sidebar.showRight', 'Show chat panel')}
              data-testid="reveal-sidebar-right"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Editor Panels */}
      <div className="flex-1 min-h-0 min-w-0 relative">
      <PanelGroup orientation="horizontal" className="h-full min-h-0 min-w-0" id="editor-panels">
        {/* Source Panel */}
        {showSource && (
          <>
            <Panel id="source" defaultSize={showTarget ? '50' : '100'} minSize="20" className="min-w-0">
              <div
                className="h-full flex flex-col min-w-0"
                style={{
                  '--editor-font-size': `${sourceFontSize}px`,
                  '--editor-line-height': sourceLineHeight,
                } as CSSProperties}
              >
                <div className="h-8 px-4 flex items-center justify-between border-b border-sky-500/20 bg-sky-500/[0.05] dark:bg-sky-400/[0.07]">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800/80 dark:text-sky-200/90">
                      {t('editor.source').toUpperCase()}
                    </span>
                    {sourceOnlyMode ? (
                      <button
                        type="button"
                        onClick={toggleSourceOnlyMode}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium text-editor-muted hover:text-sky-700 hover:bg-sky-500/10 dark:hover:text-sky-300 transition-colors"
                        title={t('editor.showTarget')}
                      >
                        {t('editor.showTarget')}
                      </button>
                    ) : showTarget ? (
                      <button
                        type="button"
                        onClick={toggleFocusMode}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium text-editor-muted hover:text-sky-700 hover:bg-sky-500/10 dark:hover:text-sky-300 transition-colors"
                        title={t('editor.hideSource')}
                      >
                        {t('editor.hideSource')}
                      </button>
                    ) : null}
                  </div>
                  <span className="text-[10px] text-editor-muted">
                    {sourceWordCount.toLocaleString()} {t('editor.words')}
                  </span>
                </div>
                <TipTapMenuBar editor={sourceEditor} panelType="source" />
                <SearchBar
                  editor={sourceEditor}
                  panelType="source"
                  isOpen={sourceSearchOpen}
                  onClose={handleSourceSearchClose}
                />
                <div className="min-h-0 flex-1 overflow-hidden relative group/source">
                  <SourceTipTapEditor
                    content={sourceDocument || ''}
                    onChange={setSourceDocument}
                    onJsonChange={setSourceDocJson}
                    className="h-full"
                    onEditorReady={handleSourceEditorReady}
                    onSearchOpen={handleSourceSearchOpen}
                    onCommentClick={handleSourceCommentClick}
                  />
                  {/* 호버 복사 버튼 */}
                  <button
                    type="button"
                    onClick={() => void handleCopySource()}
                    className="absolute top-2 right-2 opacity-0 group-hover/source:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-[10px] bg-editor-surface/60 border border-editor-border/40 flex items-center gap-1 text-editor-muted hover:text-editor-text"
                    title={t('common.copyToClipboard', '복사')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {t('common.copy', '복사')}
                  </button>
                </div>
              </div>
            </Panel>
            {showSplitHandle && (
              <PanelResizeHandle className="w-1 bg-editor-border hover:bg-primary-500 transition-colors cursor-col-resize z-10" />
            )}
          </>
        )}

        {/* Target Panel */}
        {showTarget && (
        <Panel id="target" defaultSize={showSource ? '50' : '100'} minSize="20" className="min-w-0">
          <div
            className="h-full flex flex-col min-w-0"
            style={{
              '--editor-font-size': `${targetFontSize}px`,
              '--editor-line-height': targetLineHeight,
            } as CSSProperties}
          >
            <div className="h-8 px-4 flex items-center justify-between border-b border-emerald-500/20 bg-emerald-500/[0.05] dark:bg-emerald-400/[0.07]">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800/80 dark:text-emerald-200/90">
                  {t('editor.target').toUpperCase()}
                </span>
                {focusMode ? (
                  <button
                    type="button"
                    onClick={toggleFocusMode}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium text-editor-muted hover:text-emerald-700 hover:bg-emerald-500/10 dark:hover:text-emerald-300 transition-colors"
                    title={t('editor.showSource')}
                  >
                    {t('editor.showSource')}
                  </button>
                ) : showSource ? (
                  <button
                    type="button"
                    onClick={toggleSourceOnlyMode}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium text-editor-muted hover:text-emerald-700 hover:bg-emerald-500/10 dark:hover:text-emerald-300 transition-colors"
                    title={t('editor.hideTarget')}
                  >
                    {t('editor.hideTarget')}
                  </button>
                ) : null}
                <Select
                  value={project.metadata.targetLanguage || ''}
                  onChange={setTargetLanguage}
                  options={[
                    { value: '한국어', label: t('editor.languages.korean') },
                    { value: '영어', label: t('editor.languages.english') },
                    { value: '일본어', label: t('editor.languages.japanese') },
                    { value: '중국어', label: t('editor.languages.chinese') },
                    { value: '스페인어', label: t('editor.languages.spanish') },
                    { value: '러시아어', label: t('editor.languages.russian') },
                  ]}
                  placeholder={t('editor.selectLanguage')}
                  size="sm"
                  className="min-w-[80px]"
                  data-testid="target-language-select"
                />
              </div>
              <span className="text-[10px] text-editor-muted">
                {targetWordCount.toLocaleString()} {t('editor.words')}
              </span>
            </div>
            <TipTapMenuBar editor={targetEditor} panelType="target" />
            <SearchBar
              editor={targetEditor}
              panelType="target"
              isOpen={targetSearchOpen}
              onClose={handleTargetSearchClose}
              initialReplaceMode={targetSearchReplaceMode}
            />
            {/* 여기에 transition 효과 추가 */}
            <div className={`min-h-0 flex-1 overflow-hidden transition-colors duration-500 relative group/target ${targetFlash ? 'bg-green-500/10' : ''}`}>
              <TargetTipTapEditor
                content={targetDocument || ''}
                onChange={setTargetDocument}
                onJsonChange={setTargetDocJson}
                className="h-full"
                onEditorReady={handleTargetEditorReady}
                onSearchOpen={handleTargetSearchOpen}
                onSearchOpenWithReplace={handleTargetSearchOpenWithReplace}
                onCommentClick={handleTargetCommentClick}
              />
              {/* 호버 복사 버튼 */}
              <button
                type="button"
                onClick={() => void handleCopyTarget()}
                className="absolute top-2 right-2 opacity-0 group-hover/target:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-[10px] bg-editor-surface/60 border border-editor-border/40 flex items-center gap-1 text-editor-muted hover:text-editor-text"
                title={t('common.copyToClipboard', '복사')}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {t('common.copy', '복사')}
              </button>
            </div>
          </div>
        </Panel>
        )}
      </PanelGroup>

      </div>

      {/* 폴리싱 지시사항 모달 */}
      {polishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-editor-surface border border-editor-border rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-4 py-3 border-b border-editor-border">
              <h3 className="text-sm font-semibold text-editor-text">
                {t('editor.polishModal.title', '폴리싱')}
              </h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-editor-muted">
                {t('editor.polishModal.description', '현재 번역문을 원어민 관점에서 자연스럽게 다듬습니다.')}
              </p>
              <div>
                <label className="text-xs font-medium text-editor-text">
                  {t('editor.polishModal.messageLabel', '추가 지시사항')}
                  <span className="ml-1 text-editor-muted font-normal">
                    {t('editor.polishModal.optional', '(선택)')}
                  </span>
                </label>
                <textarea
                  value={polishMessage}
                  onChange={(e) => setPolishMessage(e.target.value)}
                  placeholder={t('editor.polishModal.placeholder', '예: 더 격식체로 다듬고 제품 용어는 유지해주세요.')}
                  className="mt-1.5 w-full h-24 px-3 py-2 text-sm bg-editor-bg border border-editor-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary-500 text-editor-text placeholder:text-editor-muted"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      setPolishModalOpen(false);
                      void openPolishPreview(polishMessage);
                    }
                    if (e.key === 'Escape') {
                      setPolishModalOpen(false);
                    }
                  }}
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-editor-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPolishModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
              >
                {t('common.cancel', '취소')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPolishModalOpen(false);
                  void openPolishPreview(polishMessage);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
              >
                {t('editor.polishModal.execute', '폴리싱 실행')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 재번역 지시사항 모달 (타겟에 이미 내용이 있을 때 번역 버튼 클릭 시) */}
      {retranslateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-editor-surface border border-editor-border rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-4 py-3 border-b border-editor-border">
              <h3 className="text-sm font-semibold text-editor-text">
                {t('editor.retranslateModal.title', '재번역')}
              </h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-editor-muted">
                {t('editor.retranslateModal.description', '번역문이 이미 있습니다. 처음부터 다시 번역합니다.')}
              </p>
              <div>
                <label className="text-xs font-medium text-editor-text">
                  {t('review.retranslate.modal.messageLabel', '추가 지시사항')}
                  <span className="ml-1 text-editor-muted font-normal">
                    {t('review.retranslate.modal.optional', '(선택)')}
                  </span>
                </label>
                <textarea
                  value={retranslateMessage}
                  onChange={(e) => setRetranslateMessage(e.target.value)}
                  placeholder={t('review.retranslate.modal.placeholder', '추가로 반영할 내용을 입력하세요...')}
                  className="mt-1.5 w-full h-24 px-3 py-2 text-sm bg-editor-bg border border-editor-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary-500 text-editor-text placeholder:text-editor-muted"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      setRetranslateModalOpen(false);
                      void openTranslatePreview(retranslateMessage);
                    }
                    if (e.key === 'Escape') {
                      setRetranslateModalOpen(false);
                    }
                  }}
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-editor-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRetranslateModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
              >
                {t('common.cancel', '취소')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRetranslateModalOpen(false);
                  void openTranslatePreview(retranslateMessage);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
              >
                {t('review.retranslate.modal.execute', '재번역 실행')}
              </button>
            </div>
          </div>
        </div>
      )}

      <TranslatePreviewModal
        open={translatePreviewOpen}
        title={t('editor.previewTitleFull')}
        docJson={translatePreviewDoc}
        sourceHtml={sourceDocument}
        originalHtml={targetDocument}
        isLoading={translateLoading}
        error={translatePreviewError}
        streamingChannel="translate"
        onClose={() => {
          setTranslatePreviewOpen(false);
        }}
        onApply={applyTranslatePreview}
        onCancel={handleTranslateCancel}
        {...(translatePreviewError ? { onRetry: handleTranslateRetry } : {})}
      />

      <TranslatePreviewModal
        open={polishPreviewOpen}
        title={t('editor.polishPreviewTitle', '폴리싱 미리보기')}
        docJson={polishPreviewDoc}
        sourceHtml={targetDocument}
        originalHtml={targetDocument}
        isLoading={polishLoading}
        error={polishPreviewError}
        streamingChannel="polish"
        originalDocJson={polishOriginalDocJson}
        onApplySelective={applyPolishDoc}
        onClose={handlePolishClose}
        onApply={applyPolishPreview}
        onCancel={handlePolishCancel}
        {...(polishPreviewError ? { onRetry: handlePolishRetry } : {})}
      />

      {/* TipTap 선택 액션 메뉴 (선택 영역 우클릭) */}
      {addToChatBubble && !commentPopover && !commentDetailPopover && (
        <SelectionActionMenu
          existingComments={addToChatBubble.existingComments}
          style={{
            position: 'fixed',
            top: addToChatBubble.top,
            left: addToChatBubble.left,
            zIndex: 80,
            zoom: 1 / useUIStore.getState().editorZoom,
            backgroundColor: 'color-mix(in srgb, var(--editor-surface) 90%, transparent)',
          }}
          onAddToChat={() => {
            const text = addToChatBubble.text.trim();
            if (!text) return;
            // 선택 범위에 걸린 인라인 코멘트가 있으면 함께 첨부
            const commentLines: string[] = [];
            try {
              const ids = collectCommentIdsInRange(
                addToChatBubble.editor.state.doc,
                addToChatBubble.from,
                addToChatBubble.to,
              );
              const store = useCommentStore.getState();
              for (const id of ids) {
                const c = store.getComment(id);
                if (c && c.comment.trim()) {
                  commentLines.push(`> ${t('comment.title', '코멘트')}: ${c.comment.trim()}`);
                }
              }
            } catch {
              // 코멘트 수집 실패는 무시(텍스트만 첨부)
            }
            const composed = commentLines.length > 0
              ? `${text}\n${commentLines.join('\n')}`
              : text;
            useUIStore.getState().openActiveChat();
            appendComposerText(composed);
            requestComposerFocus();
            setAddToChatBubble(null);
          }}
          onAddComment={() => {
            const b = addToChatBubble;
            setCommentPopover({
              top: b.top + getSelectionActionMenuHeight(b.existingComments.length),
              left: b.left,
              excerpt: b.text.trim(),
              editor: b.editor,
              field: b.field,
              from: b.from,
              to: b.to,
              segmentGroupId: b.segmentGroupId,
            });
            setAddToChatBubble(null);
          }}
          onViewComment={(commentId) => {
            const b = addToChatBubble;
            openCommentDetail({
              commentId,
              editor: b.editor,
              field: b.field,
              top: b.top + getSelectionActionMenuHeight(b.existingComments.length),
              left: b.left,
            });
            setAddToChatBubble(null);
          }}
          onClose={dismissAddToChatBubble}
        />
      )}

      {/* 코멘트 입력 popover */}
      {commentPopover && (
        <CommentInputPopover
          top={commentPopover.top}
          left={commentPopover.left}
          excerpt={commentPopover.excerpt}
          zoom={1 / useUIStore.getState().editorZoom}
          onSave={(text) =>
            handleSaveComment(
              {
                editor: commentPopover.editor,
                field: commentPopover.field,
                from: commentPopover.from,
                to: commentPopover.to,
                excerpt: commentPopover.excerpt,
                segmentGroupId: commentPopover.segmentGroupId,
              },
              text,
            )
          }
          onCancel={() => setCommentPopover(null)}
        />
      )}

      {/* 코멘트 상세 popover */}
      {commentDetailPopover && activeDetailComment && (
        <CommentDetailPopover
          top={commentDetailPopover.top}
          left={commentDetailPopover.left}
          comment={activeDetailComment}
          zoom={1 / useUIStore.getState().editorZoom}
          onSave={(text) => handleUpdateComment(commentDetailPopover.commentId, text)}
          onToggleResolve={() => handleToggleCommentResolve(commentDetailPopover.commentId)}
          onDelete={() => handleDeleteComment(commentDetailPopover.commentId, commentDetailPopover.editor)}
          onCancel={closeCommentDetail}
        />
      )}
    </div>
  );
}
