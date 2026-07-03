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
import { MODEL_PRESETS } from '@/ai/config';
import { Select, type SelectOptionGroup } from '@/components/ui/Select';
import { stripHtml } from '@/utils/hash';
import { countTotalWords } from '@/utils/wordCounter';
import { searchGlossary } from '@/tauri/glossary';
import { tipTapJsonToMarkdown, tipTapJsonToMarkdownForTranslation } from '@/utils/markdownConverter';
import { getSelectionActionMenuHeight, SelectionActionMenu } from '@/components/ui/SelectionActionMenu';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';
import { MessageSquareText, Sparkles } from 'lucide-react';
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
  const translatorPersona = useChatStore((s) => s.translatorPersona);

  const openReviewPanel = useUIStore((s) => s.openReviewPanel);
  const openCommentsPanel = useUIStore((s) => s.openCommentsPanel);
  const addToast = useUIStore((s) => s.addToast);
  const focusMode = useUIStore((s) => s.focusMode);
  const sourceOnlyMode = useUIStore((s) => s.sourceOnlyMode);
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);
  const toggleSourceOnlyMode = useUIStore((s) => s.toggleSourceOnlyMode);


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
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const translateAbortController = useRef<AbortController | null>(null);

  const [polishPreviewOpen, setPolishPreviewOpen] = useState(false);
  const [polishPreviewDoc, setPolishPreviewDoc] = useState<TipTapDocJson | null>(null);
  // 선택 적용 diff 기준: 폴리싱 시작 시점의 Target 문서 스냅샷
  const [polishOriginalDocJson, setPolishOriginalDocJson] = useState<TipTapDocJson | null>(null);
  const [polishPreviewError, setPolishPreviewError] = useState<string | null>(null);
  const [polishLoading, setPolishLoading] = useState(false);
  const [polishStreamingText, setPolishStreamingText] = useState<string | null>(null);
  const polishAbortController = useRef<AbortController | null>(null);
  const [polishModalOpen, setPolishModalOpen] = useState(false);
  const [polishMessage, setPolishMessage] = useState('');

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
  const selectionTimerRef = useRef<number | null>(null);
  const selectionTokenRef = useRef<number>(0);
  // 사용자가 명시적으로 메뉴를 닫은 선택 범위 — 같은 범위엔 메뉴를 다시 띄우지 않는다.
  const dismissedSelectionRef = useRef<{ field: CommentField; from: number; to: number } | null>(null);

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

  const clearSelectionTimer = (): void => {
    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = null;
    }
  };

  const scheduleAddToChatBubble = useCallback((editor: Editor, field: CommentField) => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      clearSelectionTimer();
      setAddToChatBubble(null);
      return;
    }

    // 사용자가 방금 명시적으로 닫은 바로 그 범위면 메뉴를 다시 띄우지 않는다.
    // (선택이 다른 범위로 바뀌면 기록을 비워 다시 뜨도록 한다.)
    const dismissed = dismissedSelectionRef.current;
    if (dismissed && dismissed.field === field && dismissed.from === from && dismissed.to === to) {
      clearSelectionTimer();
      setAddToChatBubble(null);
      return;
    }
    dismissedSelectionRef.current = null;

    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!selectedText) {
      clearSelectionTimer();
      setAddToChatBubble(null);
      return;
    }

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

    // 드래그 후 1초 정도 멈추면 버튼 표시
    clearSelectionTimer();
    setAddToChatBubble(null);
    const token = Date.now();
    selectionTokenRef.current = token;

    selectionTimerRef.current = window.setTimeout(() => {
      if (selectionTokenRef.current !== token) return;

      try {
        const coords = editor.view.coordsAtPos(to);
        const top = Math.max(8, coords.top - 36);
        const left = Math.min(window.innerWidth - 200, Math.max(8, coords.left));
        const commentIds = collectCommentIdsInRange(editor.state.doc, from, to);
        const store = useCommentStore.getState();
        const existingComments = commentIds.flatMap((id) => {
          const comment = store.getComment(id);
          return comment ? [{ id: comment.id, excerpt: comment.excerpt }] : [];
        });
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
      } catch {
        // ignore
      }
    }, 1000);
  }, [project]);

  const attachSelectionWatcher = useCallback((editor: Editor, field: CommentField) => {
    // TipTap 이벤트로 selection 변화 감지
    const onSelection = (): void => scheduleAddToChatBubble(editor, field);
    const onBlur = (): void => {
      clearSelectionTimer();
      setAddToChatBubble(null);
    };

    editor.on('selectionUpdate', onSelection);
    editor.on('blur', onBlur);

    // 초기 상태 반영
    onSelection();

    return () => {
      editor.off('selectionUpdate', onSelection);
      editor.off('blur', onBlur);
    };
  }, [scheduleAddToChatBubble]);

  // 메뉴만 닫기 (닫기 버튼 / 메뉴 바깥 클릭). 선택 영역은 그대로 유지한다.
  const dismissAddToChatBubble = useCallback((): void => {
    setAddToChatBubble((prev) => {
      if (prev) {
        dismissedSelectionRef.current = { field: prev.field, from: prev.from, to: prev.to };
      }
      return null;
    });
    clearSelectionTimer();
  }, []);

  const openCommentDetail = useCallback((params: {
    commentId: string;
    editor: Editor;
    field: CommentField;
    top: number;
    left: number;
  }): void => {
    clearSelectionTimer();
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
    setStreamingText(null);

    // AbortController 생성
    const abortController = new AbortController();
    translateAbortController.current = abortController;

    try {
      const sourceDocJson = sourceEditorRef.current.getJSON() as Record<string, unknown>;

      // 용어집 검색 (채팅 모드와 동일한 패턴)
      let glossary = '';
      try {
        // 원문을 Markdown으로 변환하여 검색 쿼리로 사용
        const sourceMarkdown = tipTapJsonToMarkdown(sourceDocJson);
        const query = sourceMarkdown.slice(0, 2000); // 앞부분 2000자로 검색
        if (query.trim().length > 0) {
          const hits = await searchGlossary({
            projectId: project.id,
            query,
            domain: project.metadata.domain,
            limit: 30, // 번역은 전체 문서이므로 더 많이
          });
          if (hits.length > 0) {
            glossary = hits
              .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
              .join('\n');
            console.warn(`[Translation] Glossary injected: ${hits.length} terms`);
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
        translatorPersona,
        glossary,
        ...(serializedComments ? { userComments: serializedComments } : {}),
        ...(trimmedMessage ? { retranslateMessage: trimmedMessage } : {}),
        onToken: (text) => {
          setStreamingText(text);
        },
        abortSignal: abortController.signal,
      });
      setTranslatePreviewDoc(doc);
      setStreamingText(null); // 완료 후 스트리밍 텍스트 초기화
    } catch (e) {
      // 취소된 경우
      if (abortController.signal.aborted) {
        setTranslatePreviewError('번역이 취소되었습니다.');
      } else {
        console.error('[Translation] preview failed:', e);
        setTranslatePreviewError(formatTranslationError(e));
      }
    } finally {
      setTranslateLoading(false);
      translateAbortController.current = null;
    }
  }, [
    project,
    translationRules,
    projectContext,
    translatorPersona,
    addToast,
    t,
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
    setPolishStreamingText(null);

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
      const { doc } = await polishTargetDocumentWithStreaming({
        targetDocJson,
        targetLanguage: project.metadata.targetLanguage,
        styleRules: translationRules,
        ...(serializedComments ? { userComments: serializedComments } : {}),
        ...(trimmedMessage ? { polishMessage: trimmedMessage } : {}),
        onToken: (text) => setPolishStreamingText(text),
        abortSignal: abortController.signal,
      });
      setPolishPreviewDoc(doc);
      setPolishStreamingText(null);
    } catch (error) {
      if (abortController.signal.aborted) {
        setPolishPreviewError(t('editor.polishCancelled', '폴리싱이 취소되었습니다.'));
      } else {
        setPolishPreviewError(formatTranslationError(error));
      }
    } finally {
      setPolishLoading(false);
      polishAbortController.current = null;
    }
  }, [addToast, hasTargetContent, project, t, translationRules]);

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
    setStreamingText(null);
  }, []);

  const applyTranslatePreview = useCallback((): void => {
    if (!translatePreviewDoc) return;
    if (!targetEditorRef.current) {
      addToast({ type: 'error', message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.') });
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
    }
  }, [translatePreviewDoc, addToast, t, createSnapshotIfChanged]);

  const handlePolishCancel = useCallback((): void => {
    if (polishAbortController.current) {
      polishAbortController.current.abort();
    }
    setPolishLoading(false);
    setPolishPreviewOpen(false);
    setPolishStreamingText(null);
  }, []);

  // 폴리싱 미리보기 종료 시 스냅샷 상태를 함께 정리 (ReviewPanel handleRetranslateClose와 대칭).
  // 재열기 경로가 항상 재스냅샷하므로 correctness 이슈는 아니지만, 문서 JSON 상주를 방지한다.
  const handlePolishClose = useCallback((): void => {
    setPolishPreviewOpen(false);
    setPolishPreviewDoc(null);
    setPolishOriginalDocJson(null);
    setPolishPreviewError(null);
    setPolishStreamingText(null);
  }, []);

  const applyPolishDoc = useCallback((doc: TipTapDocJson): void => {
    if (!targetEditorRef.current) {
      addToast({ type: 'error', message: t('editor.targetEditorNotReady', 'Target 에디터가 아직 준비되지 않았습니다.') });
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
    }
  }, [addToast, t, createSnapshotIfChanged, handlePolishClose]);

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
      clearSelectionTimer();
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
        <div className="flex items-center gap-3">
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
            <MessageSquareText className="w-4 h-4" />
            {commentCount > 0 && (
              <span className="tabular-nums text-[11px] font-semibold text-editor-text">{commentCount}</span>
            )}
          </button>
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
        streamingText={streamingText}
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
        streamingText={polishStreamingText}
        originalDocJson={polishOriginalDocJson}
        onApplySelective={applyPolishDoc}
        onClose={handlePolishClose}
        onApply={applyPolishPreview}
        onCancel={handlePolishCancel}
        {...(polishPreviewError ? { onRetry: handlePolishRetry } : {})}
      />

      {/* TipTap 선택 액션 메뉴 (드래그 후 1초) */}
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
