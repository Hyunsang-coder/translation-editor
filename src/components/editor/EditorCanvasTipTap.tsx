import { useTranslation } from 'react-i18next';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useEditorStore } from '@/stores/editorStore';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';
import { TipTapMenuBar } from './TipTapMenuBar';
import { StatusStrip } from '@/components/layout/StatusStrip';
import { TranslatePreviewModal } from './TranslatePreviewModal';
import { SearchBar } from './SearchBar';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/react';
import type { Slice } from '@tiptap/pm/model';
import {
  translateWithStreaming,
  formatTranslationError,
  type TipTapDocJson,
} from '@/ai/translateDocument';
import { polishTargetDocumentWithStreaming } from '@/ai/polishDocument';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { getModelIdForUse } from '@/ai/config';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { hashContent, stripHtml } from '@/utils/hash';
import {
  AUTO_TARGET_LANGUAGE,
  detectSourceLanguage,
  isSameLanguage,
  normalizeLang,
  resolveTargetLanguage,
} from '@/utils/detectLanguage';
import { tipTapJsonToMarkdown, tipTapJsonToMarkdownForTranslation } from '@/utils/markdownConverter';
import {
  SelectionInlineToolbar,
  SELECTION_INLINE_TOOLBAR_HEIGHT,
} from '@/components/ui/SelectionInlineToolbar';
import {
  buildContinuationPlan,
  type ContinuationPlan,
  type ContinuationPlanResult,
} from '@/editor/utils/continueTranslation';
import {
  appendTopLevelBlocks,
  replaceTopLevelBlockRange,
} from '@/editor/utils/topLevelBlockSplice';
import {
  countScopedCells,
  resolveAiSelectionScope,
  resolveTableColumnHeader,
  type AiSelectionScope,
} from '@/editor/utils/tableRangeScope';
import {
  TableStructureMismatchError,
  extractBlockDoc,
  extractTableRectDoc,
  replaceBlockAtPath,
  replaceTableRect,
} from '@/editor/utils/tableRectSplice';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';
import { replaceDocumentWithAppliedChanges } from '@/editor/utils/applyDocumentWithHighlight';
import { AlignmentView } from '@/components/editor/AlignmentView';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { BAND_1, BAND_2, CAPTION } from '@/constants/styles';
import { useCommentStore, type CommentField } from '@/stores/commentStore';
import { CommentInputPopover } from '@/components/comment/CommentInputPopover';
import { CommentDetailPopover } from '@/components/comment/CommentDetailPopover';
import { serializeUserComments } from '@/ai/commentContext';
import {
  collectCommentIdsInRange,
  removeCommentMark,
} from '@/editor/utils/commentNavigation';
import {
  getChatSessionId,
  isChatPanel,
  type ITEProject,
  type SelectionContext,
} from '@/types';
import { v4 as uuidv4 } from 'uuid';
import {
  createSelectionAnchor,
  getSingleAnchorRange,
  normalizeSelectionAnchorRanges,
  readAnchorRangesText,
  splitSelectionAnchorRanges,
  readAnchorText,
  removeSelectionAnchor,
  resolveSelectionAnchor,
  type SelectionRange,
} from '@/editor/extensions/SelectionAnchor';
import { getTranslationUnitIdsAtRange } from '@/editor/extensions/TranslationUnitId';
import {
  collectTranslationUnits,
  dropAncestorUnits,
  type TranslationUnitDocument,
} from '@/editor/extensions/TranslationUnitId';
import { useReviewStore } from '@/stores/reviewStore';
import { findAlignedCounterpartUnits } from '@/editor/utils/alignedCounterpartUnits';
import {
  SelectionEditPreviewModal,
  type SelectionEditCell,
} from './SelectionEditPreviewModal';
import {
  DEFAULT_SELECTION_REFERENCE_OPTIONS,
  type ContextManifest,
  type ContextReferenceOptions,
} from '@/types';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { resolveGlossaryEntries } from '@/utils/glossaryInject';
import {
  polishSegments,
  polishSelection,
  retranslateSelection,
  retranslateSegments,
  type RetranslateSurroundings,
  type SelectionEditMode,
  type TableColumnHeaderContext,
} from '@/ai/retranslateSelection';
import { getSelectionSurroundings } from '@/ai/tools/selectionTools';
import {
  applySelectionEdit,
  applySelectionEdits,
  canApplySelectionEdits,
  selectionHasUniformFormatting,
} from '@/editor/utils/applySelectionEdit';
import { useInstructionHistoryStore } from '@/stores/instructionHistoryStore';
import { RecentInstructions } from '@/components/ui/RecentInstructions';
import { syncCommentExcerpts } from '@/editor/utils/syncCommentExcerpts';
import {
  resolveInitialAlignedSourceRange,
  type SourceAlignmentPrecision,
} from '@/editor/utils/alignedSelectionRange';
import {
  buildContextSnapshot,
  resolveWorkflowContextFromSnapshot,
} from '@/ai/context/resolveWorkflowContext';
import {
  serializeSelectionForClipboard,
  writeRichClipboard,
} from '@/utils/editorClipboard';

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

/** 인라인 선택 툴바 표시 지연 — 드래그 중에 따라다니지 않게 한다 */
const SELECTION_TOOLBAR_DELAY_MS = 150;

/**
 * 멀티블록 선택 본문의 상한. 선택 텍스트는 user 메시지에 그대로 실리므로
 * (`prompt.ts`의 SELECTION 블록) 문서 한 덩이를 통째로 넣는 것을 막는다.
 * `get_selection_surroundings`의 출력 상한과 같은 값 — 도구가 심하게 축약되는
 * 구간을 애초에 만들지 않는다.
 */
const MAX_MULTI_BLOCK_SELECTION_CHARS = 4_000;

/** 자동 판정 결과를 UI 언어로 보여주기 위한 매핑. 모르는 언어면 받은 문자열을 그대로 쓴다. */
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
  ko: 'editor.languages.korean',
  en: 'editor.languages.english',
  ja: 'editor.languages.japanese',
  zh: 'editor.languages.chinese',
  es: 'editor.languages.spanish',
  ru: 'editor.languages.russian',
};

function localizeLanguage(t: (key: string) => string, language: string): string {
  const key = LANGUAGE_LABEL_KEYS[normalizeLang(language) ?? ''];
  return key ? t(key) : language;
}

/**
 * 자동 판정에 쓸 원문 표본. HTML 태그가 부풀리는 몫을 감안해 넉넉히 자른 뒤 태그를 벗긴다
 * (`detectSourceLangCode`가 다시 4,000자로 자른다).
 */
function sourceSampleFromHtml(html: string | null | undefined): string {
  return stripHtml((html || '').slice(0, 12_000));
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

  const setComposerSelection = useChatStore((s) => s.setComposerSelection);
  const requestComposerFocus = useChatStore((s) => s.requestComposerFocus);
  const translationRules = useChatStore((s) => s.translationRules);

  const addToast = useUIStore((s) => s.addToast);
  const focusMode = useUIStore((s) => s.focusMode);
  const sourceOnlyMode = useUIStore((s) => s.sourceOnlyMode);
  const toggleFocusMode = useUIStore((s) => s.toggleFocusMode);
  const toggleSourceOnlyMode = useUIStore((s) => s.toggleSourceOnlyMode);
  const editorViewMode = useUIStore((s) => s.editorViewMode);
  const setEditorViewMode = useUIStore((s) => s.setEditorViewMode);

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

  const createSnapshotIfChanged = useHistoryStore((s) => s.createSnapshotIfChanged);

  const comments = useCommentStore((s) => s.comments);

  const sourceEditorRef = useRef<Editor | null>(null);
  const targetEditorRef = useRef<Editor | null>(null);
  const [sourceEditor, setSourceEditor] = useState<Editor | null>(null);
  const [targetEditor, setTargetEditor] = useState<Editor | null>(null);

  /**
   * '자동'을 골랐을 때 실제로 어느 언어로 번역되는지 — Select 라벨이 밝힌다.
   * 저장값은 센티널로 두고 표시할 때만 푼다(자동이 사용자 선택을 덮지 않는다).
   */
  const autoResolvedLanguage = useMemo(
    () => resolveTargetLanguage(AUTO_TARGET_LANGUAGE, sourceSampleFromHtml(sourceDocument)).language,
    [sourceDocument],
  );

  /**
   * 실행 시점의 타겟 언어. 스토어의 HTML 캐시는 에디터 onChange 디바운스로 뒤처질 수 있어
   * 살아있는 에디터 텍스트를 먼저 본다 — 방금 붙여넣은 원문으로 방향이 잡혀야 한다.
   */
  const resolveTargetLanguageNow = useCallback((): string | null => {
    const sourceText = sourceEditorRef.current?.getText() || sourceSampleFromHtml(sourceDocument);
    return resolveTargetLanguage(project?.metadata.targetLanguage, sourceText).language;
  }, [project?.metadata.targetLanguage, sourceDocument]);

  // 추가: Flash 효과 상태
  const [targetFlash, setTargetFlash] = useState(false);

  // 검색바 상태 (패널별 독립)
  const [sourceSearchOpen, setSourceSearchOpen] = useState(false);
  const [targetSearchOpen, setTargetSearchOpen] = useState(false);
  const [targetSearchReplaceMode, setTargetSearchReplaceMode] = useState(false);

  const [translatePreviewOpen, setTranslatePreviewOpen] = useState(false);
  const [translatePreviewDoc, setTranslatePreviewDoc] = useState<Record<string, unknown> | null>(null);
  // 선택 적용 diff 기준: 재번역 시작 시점의 Target 문서 스냅샷 (폴리싱의 polishOriginalDocJson 대칭).
  // 첫 번역(빈 target)은 null — 비교할 원본이 없으므로 변경사항 탭 없이 기존 동작 그대로.
  const [translateOriginalDocJson, setTranslateOriginalDocJson] = useState<TipTapDocJson | null>(null);
  const [translatePreviewError, setTranslatePreviewError] = useState<string | null>(null);
  // 진행 상태는 uiStore에 둔다 — 상단 툴바(WorkflowActions)와 프리뷰 모달이 함께 읽는다.
  const translateLoading = useUIStore((s) => s.translateLoading);
  const setTranslateLoading = useUIStore((s) => s.setTranslateLoading);
  const translateAbortController = useRef<AbortController | null>(null);

  const [polishPreviewOpen, setPolishPreviewOpen] = useState(false);
  const [polishPreviewDoc, setPolishPreviewDoc] = useState<TipTapDocJson | null>(null);
  // 선택 적용 diff 기준: 폴리싱 시작 시점의 Target 문서 스냅샷
  const [polishOriginalDocJson, setPolishOriginalDocJson] = useState<TipTapDocJson | null>(null);
  const [polishPreviewError, setPolishPreviewError] = useState<string | null>(null);
  const polishLoading = useUIStore((s) => s.polishLoading);
  const setPolishLoading = useUIStore((s) => s.setPolishLoading);
  const polishAbortController = useRef<AbortController | null>(null);
  const [polishModalOpen, setPolishModalOpen] = useState(false);
  const [polishMessage, setPolishMessage] = useState('');
  // 폴리싱 범위 실행: 모달을 열 때의 target 선택을 최상위 블록 구간으로 해석해 둔다.
  // null이면 스코프 UI를 노출하지 않는다(선택이 없거나 번역 유닛이 없는 선택).
  const [polishScope, setPolishScope] = useState<AiSelectionScope | null>(null);
  const [polishScopeEnabled, setPolishScopeEnabled] = useState(true);

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
  // 모달을 열 때 계산한 "이어서 번역" 가능 여부 (요청 단위 휘발성 — 영속하지 않는다)
  const [continuationPlanResult, setContinuationPlanResult] = useState<ContinuationPlanResult | null>(null);

  // 검수 모달 상태는 더 이상 사용하지 않음 (Review 탭으로 대체)

  // 인라인 툴바와 단축키(⌘L) 경로가 같은 페이로드를 쓴다 (액션 핸들러 공유).
  interface SelectionBubble {
    top: number;
    left: number;
    text: string;
    editor: Editor;
    field: CommentField;
    /** 선택 전체를 감싸는 범위 — 툴바 위치 계산용. 다중 범위는 사이가 비어 있을 수 있다. */
    from: number;
    to: number;
    /** 실제 선택 범위(문서 순서). 표 다중 셀 선택은 셀마다 하나씩 들어온다. */
    ranges: SelectionRange[];
    /** 선택 시점의 불변 ProseMirror 조각 — 툴바 클릭으로 포커스가 바뀌어도 복사 내용 유지. */
    slice: Slice;
    segmentGroupId: string | undefined;
  }

  // 텍스트를 선택하면 뜨는 인라인 툴바 (선택 액션의 유일한 진입점)
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionBubble | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const [selectionEdit, setSelectionEdit] = useState<null | {
    selection: SelectionContext;
    /** 재번역인지 폴리싱인지. 생성 호출·모달 문구·원문 필수 여부가 갈린다. */
    mode: SelectionEditMode;
    /**
     * 표 여러 셀 재번역일 때만 채워진다 (ADR-0010의 좁은 예외). 앵커 범위와 순서·개수가
     * 1:1이어야 한다 — 적용이 이 순서로 `applySelectionEdits`에 넘어간다.
     */
    cells?: SelectionEditCell[];
    /** ID로 검증된 Source 번역 유닛 전체. AI 구절 판별의 진실 공급원. */
    sourceUnitText: string;
    /** UI에 표시할 현재 최선의 대응 범위(유닛 → 문장 → AI 검증 구절). */
    sourceText: string;
    sourceAlignmentPrecision: SourceAlignmentPrecision;
    currentTargetUnitText: string;
    /** 선택 유닛 앞뒤 문맥 (모달 열 때 계산, 정렬 검증된 쪽만). 없으면 미주입. */
    surroundings?: RetranslateSurroundings;
    /** 표 셀 선택일 때 그 열의 헤더. 표 밖이거나 헤더 행이 없으면 미주입. */
    columnHeader?: TableColumnHeaderContext;
    instruction: string;
    referenceOptions: ContextReferenceOptions;
    replacementText: string;
    contextManifest: ContextManifest | undefined;
    /** 서식 혼합 선택에서 "일부 서식이 사라질 수 있음"에 동의했는지. 적용 시 평탄화. */
    flattenFormatting: boolean;
    loading: boolean;
    error: string | null;
  }>(null);
  const selectionEditAbortRef = useRef<AbortController | null>(null);
  // 부분 수정의 참조 범위. 선택마다 초기화하지 않고 프로젝트 단위로 유지한다.
  const selectionReferenceOptionsRef = useRef<ContextReferenceOptions>({
    ...DEFAULT_SELECTION_REFERENCE_OPTIONS,
  });
  // 추가 지시사항도 같은 이유로 프로젝트 단위로 유지한다. 지우려면 입력칸을 비우면 된다.
  const selectionInstructionRef = useRef<string>('');

  // 코멘트 입력 popover 상태
  const [commentPopover, setCommentPopover] = useState<null | {
    top: number;
    left: number;
    excerpt: string;
    editor: Editor;
    field: CommentField;
    /** 코멘트 마크를 붙일 범위(문서 순서). 표 다중 셀 선택은 셀마다 하나씩. */
    ranges: SelectionRange[];
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
  // 현재 선택으로부터 액션 핸들러가 공통으로 쓰는 페이로드를 만든다.
  // 좌표는 호출부가 채운다(툴바는 선택 영역 위).
  const buildSelectionBubble = useCallback((
    editor: Editor,
    field: CommentField,
  ): Omit<SelectionBubble, 'top' | 'left'> | null => {
    // 표에서 여러 셀을 드래그하면 CellSelection이고 셀마다 range가 하나씩 생긴다.
    // `selection.from/to`는 head 셀만 가리키므로(문서 순서도 아님) ranges를 쓴다.
    const ranges = editor.state.selection.ranges
      .map((range) => ({ from: range.$from.pos, to: range.$to.pos }))
      .filter((range) => range.to > range.from)
      .sort((a, b) => a.from - b.from);
    if (ranges.length === 0) return null;
    const from = ranges[0]!.from;
    const to = ranges[ranges.length - 1]!.to;

    const selectedText = ranges
      .map((range) => editor.state.doc.textBetween(range.from, range.to, '\n'))
      .join('\n')
      .trim();
    if (!selectedText) return null;

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

    return {
      text: selectedText,
      editor,
      field,
      from,
      to,
      ranges,
      slice: editor.state.selection.content(),
      segmentGroupId,
    };
  }, [project]);

  // 선택 영역 위(넘치면 아래)에 인라인 툴바를 띄운다.
  // 오른쪽 경계 클램프는 렌더 후 실측으로 처리한다(폭이 라벨 길이에 따라 달라짐).
  const openSelectionToolbar = useCallback((editor: Editor, field: CommentField): void => {
    const bubble = buildSelectionBubble(editor, field);
    if (!bubble) {
      setSelectionToolbar(null);
      return;
    }

    try {
      const start = editor.view.coordsAtPos(bubble.from);
      const end = editor.view.coordsAtPos(bubble.to);
      const above = start.top - SELECTION_INLINE_TOOLBAR_HEIGHT - 8;
      const top = above < 8 ? end.bottom + 8 : above;
      const left = Math.max(8, start.left);
      setSelectionToolbar({ ...bubble, top, left });
    } catch {
      setSelectionToolbar(null);
    }
  }, [buildSelectionBubble]);

  // 툴바 폭은 라벨(i18n)·재번역 버튼 유무에 따라 달라져 미리 알 수 없다.
  // 렌더 후 실측해서 화면 밖으로 나간 만큼만 왼쪽으로 되민다.
  // (에디터 zoom과 툴바의 역-zoom이 상쇄돼 CSS px = 화면 px이므로 그대로 뺀다.)
  useLayoutEffect(() => {
    if (!selectionToolbar) return;
    const el = selectionToolbarRef.current;
    if (!el) return;
    const overflowRight = el.getBoundingClientRect().right - (window.innerWidth - 8);
    if (overflowRight <= 0) return;
    const left = Math.max(8, selectionToolbar.left - overflowRight);
    if (left === selectionToolbar.left) return;
    setSelectionToolbar((prev) => (prev === selectionToolbar ? { ...prev, left } : prev));
  }, [selectionToolbar]);

  const attachSelectionWatcher = useCallback((editor: Editor, field: CommentField) => {
    // 인라인 툴바는 여기서 자동으로 띄운다. 드래그 중에 따라다니지 않도록 150ms
    // 디바운스하고, 선택이 비면 즉시 숨긴다.
    let toolbarTimer: number | null = null;
    const clearToolbarTimer = (): void => {
      if (toolbarTimer !== null) {
        window.clearTimeout(toolbarTimer);
        toolbarTimer = null;
      }
    };
    const onSelection = (): void => {
      const { from, to } = editor.state.selection;
      clearToolbarTimer();
      setSelectionToolbar((prev) => (prev?.editor === editor ? null : prev));
      if (from === to) return;
      toolbarTimer = window.setTimeout(() => {
        toolbarTimer = null;
        if (editor.state.selection.empty || !editor.isFocused) return;
        openSelectionToolbar(editor, field);
      }, SELECTION_TOOLBAR_DELAY_MS);
    };
    const onBlur = (): void => {
      clearToolbarTimer();
      setSelectionToolbar((prev) => (prev?.editor === editor ? null : prev));
    };
    const onTransaction = (): void => {
      const chatState = useChatStore.getState();
      const selection = chatState.composerSelection;
      if (
        !selection ||
        selection.panel !== field ||
        selection.projectId !== project?.id
      ) {
        return;
      }
      const anchor = resolveSelectionAnchor(editor, selection.anchorId);
      const targetSessionId = Object.entries(
        chatState.activeSelectionScopeIdBySession,
      ).find(([, scopeId]) => scopeId === selection.selectionScopeId)?.[0];
      // 앵커 소실(문서 통째 교체·프로젝트 전환)만 detached로 남긴다 — 사용자가
      // 다시 선택해야 한다는 신호.
      if (!anchor) {
        if (selection.status !== 'detached') {
          chatState.setComposerSelection(
            { ...selection, status: 'detached' },
            targetSessionId,
          );
        }
        return;
      }
      // 선택 텍스트가 통째로 지워짐 — 가리킬 대상이 없으니 칩과 앵커를 함께 정리.
      // (재진입 안전: 아래 dispatch로 이 핸들러가 다시 돌아도 칩이 비어 조기 반환)
      if (anchor.status !== 'active') {
        chatState.clearComposerSelection(targetSessionId);
        removeSelectionAnchor(editor, anchor.anchorId);
        return;
      }
      const text = anchor.originalText;
      // 편집으로 멀티블록 선택이 상한을 넘으면 생성 때와 같은 기준으로 정리한다
      if (
        selection.spansMultipleBlocks &&
        text.length > MAX_MULTI_BLOCK_SELECTION_CHARS
      ) {
        chatState.clearComposerSelection(targetSessionId);
        removeSelectionAnchor(editor, anchor.anchorId);
        addToast({
          type: 'error',
          message: t('selection.tooLong', {
            length: text.length,
            max: MAX_MULTI_BLOCK_SELECTION_CHARS,
            defaultValue: `선택이 너무 깁니다(${text.length}자). ${MAX_MULTI_BLOCK_SELECTION_CHARS}자 이하로 선택해주세요.`,
          }),
        });
        return;
      }
      // 앵커가 편집을 따라 재기준화되므로 칩 텍스트·범위도 함께 갱신한다.
      // 칩이 항상 현재 문서와 같아 stale 배지가 필요 없다.
      const first = anchor.ranges[0]!;
      const last = anchor.ranges[anchor.ranges.length - 1]!;
      if (
        selection.text !== text ||
        selection.from !== first.from ||
        selection.to !== last.to ||
        selection.status !== 'active'
      ) {
        chatState.setComposerSelection(
          { ...selection, text, from: first.from, to: last.to, status: 'active' },
          targetSessionId,
        );
      }
    };

    editor.on('selectionUpdate', onSelection);
    editor.on('blur', onBlur);
    editor.on('transaction', onTransaction);

    return () => {
      clearToolbarTimer();
      editor.off('selectionUpdate', onSelection);
      editor.off('blur', onBlur);
      editor.off('transaction', onTransaction);
    };
  }, [openSelectionToolbar, project?.id, addToast, t]);

  const createChatSelection = useCallback((
    bubble: SelectionBubble,
    // 재번역만 켠다. 앵커 범위를 textblock 단위로 쪼개야 블록마다 독립 교체가 되는데
    // (멀티문단 TextSelection은 range가 하나로 온다), 채팅 참조·코멘트는 쪼갤 이유가
    // 없으므로 기존 정규화를 그대로 둔다.
    options?: { splitByBlock?: boolean },
  ): SelectionContext | null => {
    if (!project) return null;
    try {
      const normalized = options?.splitByBlock
        ? splitSelectionAnchorRanges(bubble.editor, bubble.ranges)
        : normalizeSelectionAnchorRanges(bubble.editor, bubble.ranges);
      if (!normalized) {
        throw new Error(
          t('selection.textRequired', '선택 영역에서 텍스트를 찾을 수 없습니다.'),
        );
      }
      const text = readAnchorRangesText(
        bubble.editor.state.doc,
        normalized.ranges,
      ).trim();
      if (!text) return null;
      // 멀티블록 선택은 문서 한 덩이를 통째로 담을 수 있어 상한을 둔다. 단일 문단에는
      // 걸지 않는다 — 긴 문단의 재번역이 오늘보다 나빠지면 회귀다.
      const spansMultipleBlocks = normalized.blockCount > 1;
      if (spansMultipleBlocks && text.length > MAX_MULTI_BLOCK_SELECTION_CHARS) {
        throw new Error(
          t('selection.tooLong', {
            length: text.length,
            max: MAX_MULTI_BLOCK_SELECTION_CHARS,
            defaultValue: `선택이 너무 깁니다(${text.length}자). ${MAX_MULTI_BLOCK_SELECTION_CHARS}자 이하로 선택해주세요.`,
          }),
        );
      }
      const anchorId = createSelectionAnchor(bubble.editor, {
        ranges: normalized.ranges,
      });
      const first = normalized.ranges[0]!;
      const last = normalized.ranges[normalized.ranges.length - 1]!;
      const selectionId = uuidv4();
      return {
        selectionId,
        selectionScopeId: uuidv4(),
        projectId: project.id,
        panel: bubble.field,
        text,
        from: first.from,
        to: last.to,
        anchorId,
        // 범위마다 따로 모은다 — 다중 범위의 span으로 훑으면 고르지 않은 셀의
        // 유닛까지 섞인다.
        translationUnitIds: [...new Set(normalized.ranges.flatMap(
          (range: SelectionRange) => getTranslationUnitIdsAtRange(
            bubble.editor.state.doc,
            range.from,
            range.to,
          ),
        ))],
        ...(bubble.segmentGroupId ? { segmentGroupId: bubble.segmentGroupId } : {}),
        documentRevision: hashContent(JSON.stringify(bubble.editor.getJSON())),
        status: 'active',
        spansMultipleBlocks,
        createdAt: Date.now(),
      };
    } catch (error) {
      addToast({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : t('selection.textRequired', '선택 영역에서 텍스트를 찾을 수 없습니다.'),
      });
      return null;
    }
  }, [project, addToast, t]);

  const openChatWithSelection = useCallback((selection: SelectionContext): void => {
    // 기존 칩을 새 선택으로 교체할 때 이전 앵커(하이라이트)가 남지 않도록 정리
    const previous = useChatStore.getState().composerSelection;
    if (previous && previous.anchorId !== selection.anchorId) {
      const previousEditor =
        previous.panel === 'source' ? sourceEditorRef.current : targetEditorRef.current;
      if (previousEditor) removeSelectionAnchor(previousEditor, previous.anchorId);
    }

    const uiState = useUIStore.getState();
    uiState.openActiveChat();

    const openedState = useUIStore.getState();
    let targetSessionId = openedState.floatingChatSessionId;
    if (!targetSessionId) {
      for (const sidebar of [openedState.rightSidebar, openedState.leftSidebar]) {
        if (
          !sidebar.hidden &&
          sidebar.activePanel &&
          isChatPanel(sidebar.activePanel)
        ) {
          targetSessionId = getChatSessionId(sidebar.activePanel);
          if (targetSessionId) break;
        }
      }
    }

    setComposerSelection(selection, targetSessionId ?? undefined);
    requestComposerFocus(targetSessionId ?? undefined);
  }, [requestComposerFocus, setComposerSelection]);

  const handleSelectionShortcut = useCallback((
    editor: Editor,
    field: CommentField,
  ): void => {
    const bubble = buildSelectionBubble(editor, field);
    if (!bubble) return;
    const selection = createChatSelection({ ...bubble, top: 0, left: 0 });
    if (!selection) return;
    openChatWithSelection(selection);
  }, [buildSelectionBubble, createChatSelection, openChatWithSelection]);

  /**
   * 선택 구간만 검수. 유닛 ID를 요청에 실어 보내고 패널을 연다 — 실제 정렬/청크
   * 구성은 ReviewPanel이 `buildScopedAlignedChunks`로 하고, 실패하면 거기서 막는다.
   */
  const openScopedReview = useCallback((bubble: SelectionBubble): void => {
    if (bubble.field !== 'target') return;

    const doc = bubble.editor.state.doc;
    const unitIds = new Set<string>();
    for (const range of bubble.ranges) {
      for (const id of getTranslationUnitIdsAtRange(doc, range.from, range.to)) {
        unitIds.add(id);
      }
    }
    if (unitIds.size === 0) {
      addToast({
        type: 'warning',
        message: t('review.scope.noUnits'),
      });
      return;
    }

    // 라벨의 개수는 실제로 검수될 단위 수 — 표 셀은 셀과 내부 문단이 함께 잡히므로
    // 조상을 버린 뒤 센다 (buildScopedAlignedChunks와 같은 기준).
    const selectedUnits = dropAncestorUnits(
      collectTranslationUnits(bubble.editor.getJSON() as TranslationUnitDocument).filter(
        (unit) => unit.id && unitIds.has(unit.id),
      ),
    ).filter((unit) => unit.text.trim().length > 0);

    if (selectedUnits.length === 0) {
      addToast({ type: 'warning', message: t('review.scope.noUnits') });
      return;
    }

    useUIStore.getState().openReviewPanel();
    useReviewStore.getState().requestReviewRun('', {
      targetUnitIds: [...unitIds],
      label: t('review.scope.label', { count: selectedUnits.length }),
    });
  }, [addToast, t]);

  /**
   * 인라인 툴바의 선택 영역 AI. 재번역과 폴리싱은 앵커·적용·검증 경로를 전부 공유하고
   * 생성 호출과 "원문이 필수인가"만 다르다 — 그 둘만 mode로 가른다.
   */
  const openSelectionEdit = useCallback(async (
    bubble: SelectionBubble,
    mode: SelectionEditMode,
  ): Promise<void> => {
    if (bubble.field !== 'target') return;
    const selection = createChatSelection(bubble, { splitByBlock: true });
    if (!selection) return;
    const selectionAnchor = resolveSelectionAnchor(bubble.editor, selection.anchorId);
    if (!selectionAnchor) {
      removeSelectionAnchor(bubble.editor, selection.anchorId);
      addToast({
        type: 'error',
        message: t('selection.reselectRequired', '문서가 변경되었습니다. 영역을 다시 선택해주세요.'),
      });
      return;
    }
    // 적용 경로가 못 다루는 선택은 생성 전에 막는다. 여기서 통과시키면 재번역을 다
    // 받아놓고 적용 단계에서만 실패한다.
    //
    // 예외는 표 셀뿐이다 — 서로 다른 셀의 단일 textblock 범위들은 셀마다 독립적으로
    // 교체할 수 있다(ADR-0010의 좁은 예외). 생성 게이트와 적용 게이트가 같은 술어를
    // 쓰도록 `canApplySelectionEdits`를 그대로 쓴다.
    const multiSegment =
      selectionAnchor.ranges.length > 1 &&
      canApplySelectionEdits(bubble.editor, selectionAnchor);
    if (selection.spansMultipleBlocks && !multiSegment) {
      removeSelectionAnchor(bubble.editor, selection.anchorId);
      addToast({
        type: 'error',
        message: t('selection.sameBlockRequired', '한 문단 안의 텍스트만 선택해주세요.'),
      });
      return;
    }
    // 서식이 섞인 범위는 공통 서식으로 평탄화되므로(부분 굵게 등 소실) 막지 않고
    // 확인을 받은 뒤 진행한다. 동의는 이 요청의 적용 단계까지 유지된다.
    let flattenFormatting = false;
    if (!selectionHasUniformFormatting(bubble.editor, selectionAnchor)) {
      const accepted = await confirm(
        mode === 'polish'
          ? t(
              'selection.mixedFormattingConfirmPolish',
              '선택 범위에 서로 다른 서식이 섞여 있습니다. 폴리싱을 적용하면 일부 서식이 사라질 수 있습니다. 계속할까요?',
            )
          : t(
              'selection.mixedFormattingConfirm',
              '선택 범위에 서로 다른 서식이 섞여 있습니다. 재번역을 적용하면 일부 서식이 사라질 수 있습니다. 계속할까요?',
            ),
        { title: t('selection.mixedFormattingConfirmTitle', '서식 안내'), kind: 'warning' },
      );
      if (!accepted) {
        removeSelectionAnchor(bubble.editor, selection.anchorId);
        return;
      }
      flattenFormatting = true;
    }
    const sourceDoc = sourceEditorRef.current?.getJSON() as TranslationUnitDocument | undefined;
    if (!sourceDoc) {
      removeSelectionAnchor(bubble.editor, selection.anchorId);
      addToast({
        type: 'error',
        message: t('selection.alignedSourceMissing', '연결된 원문을 찾을 수 없습니다.'),
      });
      return;
    }
    // 표 셀 선택은 셀 유닛과 안쪽 문단 유닛이 함께 잡힌다. 조상(셀)을 버리지
    // 않으면 셀 전체가 원문으로 들어가고 선택 문단이 한 번 더 반복된다.
    // 전체 번역을 거치지 않은 문서는 Source/Target ID가 독립 발급이라 직접 매칭이
    // 안 된다. 그때는 정렬 뷰와 같은 LCS 정렬로 짝짓고, 결과는 모달에서 원문으로
    // 표시되어 사람이 확인한 뒤에 적용된다.
    const targetDoc = bubble.editor.getJSON() as TranslationUnitDocument;
    const alignedSourceText = (unitIds: string[]): string =>
      dropAncestorUnits(findAlignedCounterpartUnits(sourceDoc, targetDoc, unitIds))
        .map((unit) => unit.text)
        .join('\n');

    // 표 셀은 짧은 명사구가 많아 어의가 열 제목에 달려 있다. 앞뒤 유닛 문맥은 행 우선
    // 순서라 대체로 무관하므로, 표 안에서는 열 헤더를 문맥으로 준다.
    const columnHeaderAt = (pos: number): TableColumnHeaderContext | undefined => {
      const header = resolveTableColumnHeader(
        bubble.editor.state.doc,
        bubble.editor.state.doc.resolve(pos),
      );
      if (!header) return undefined;
      const source = alignedSourceText(header.unitIds).trim();
      return { target: header.text, ...(source ? { source } : {}) };
    };

    if (multiSegment) {
      // 블록마다 따로 원문을 짝짓는다 — 전체를 한 번에 짝지으면 어느 원문이 어느
      // 블록 것인지 잃는다. 짝을 못 찾은 블록은 원문 없이 기존 번역문만 다듬는다
      // (모달과 프롬프트 양쪽에 "원문 미확인"으로 드러낸다).
      const segments = selectionAnchor.ranges.map((range) => {
        const columnHeader = columnHeaderAt(range.from);
        const sourceText = alignedSourceText(
          getTranslationUnitIdsAtRange(bubble.editor.state.doc, range.from, range.to),
        ).trim();
        return {
          sourceText,
          currentText: readAnchorText(bubble.editor.state.doc, range.from, range.to),
          replacementText: '',
          ...(columnHeader ? { columnHeader } : {}),
        };
      });
      // 전부 짝이 없으면 재번역이 아니라 순수 폴리싱이 된다 — 단일 경로와 같은 기준으로 막는다.
      // (폴리싱은 애초에 원문 없이 다듬는 것이 정상 경로라 막지 않는다.)
      if (mode !== 'polish' && segments.every((segment) => !segment.sourceText)) {
        removeSelectionAnchor(bubble.editor, selection.anchorId);
        addToast({
          type: 'error',
          message: t('selection.alignedSourceMissing', '연결된 원문을 찾을 수 없습니다.'),
        });
        return;
      }
      setSelectionEdit({
        selection,
        mode,
        cells: segments,
        // 블록별 대응은 카드가 보여준다. 단일 선택용 필드는 생성 입력(용어 검색)과
        // 버튼 활성 판정에만 쓰이므로 블록 원문을 이어 붙인 값을 넣는다.
        sourceUnitText: segments.map((segment) => segment.sourceText).filter(Boolean).join('\n'),
        sourceText: segments.map((segment) => segment.sourceText).filter(Boolean).join('\n'),
        sourceAlignmentPrecision: 'unit',
        currentTargetUnitText: selection.text,
        instruction: selectionInstructionRef.current,
        referenceOptions: { ...selectionReferenceOptionsRef.current },
        replacementText: '',
        contextManifest: undefined,
        flattenFormatting,
        loading: false,
        error: null,
      });
      return;
    }

    const sourceUnitText = alignedSourceText(selection.translationUnitIds);
    if (mode !== 'polish' && !sourceUnitText.trim()) {
      removeSelectionAnchor(bubble.editor, selection.anchorId);
      addToast({
        type: 'error',
        message: t('selection.alignedSourceMissing', '연결된 원문을 찾을 수 없습니다.'),
      });
      return;
    }
    const anchorRange = getSingleAnchorRange(selectionAnchor);
    if (!anchorRange) {
      removeSelectionAnchor(bubble.editor, selection.anchorId);
      addToast({
        type: 'error',
        message: t('selection.sameBlockRequired', '한 문단 안의 텍스트만 선택해주세요.'),
      });
      return;
    }
    const $from = bubble.editor.state.doc.resolve(anchorRange.from);
    const $to = bubble.editor.state.doc.resolve(anchorRange.to);
    if (!$from.sameParent($to) || !$from.parent.isTextblock) {
      removeSelectionAnchor(bubble.editor, selection.anchorId);
      addToast({
        type: 'error',
        message: t('selection.sameBlockRequired', '한 문단 안의 텍스트만 선택해주세요.'),
      });
      return;
    }
    // 채팅의 get_aligned_selection_context가 도구로 가져오는 앞뒤 문맥을 단발 호출에도
    // 고정 주입한다. Target 주변은 같은 문서라 ID로 확정. Source 주변은 같은 ID가 원문에
    // 있을 때(전체 번역을 거친 문서)만 — LCS 짝의 이웃은 검증할 방법이 없어 주입하지 않는다.
    let surroundings: RetranslateSurroundings | undefined;
    try {
      const targetCtx = getSelectionSurroundings(targetDoc, selection.translationUnitIds);
      let sourceCtx: { before: string[]; after: string[] } | null = null;
      try {
        sourceCtx = getSelectionSurroundings(sourceDoc, selection.translationUnitIds);
      } catch {
        sourceCtx = null;
      }
      surroundings = {
        sourceBefore: sourceCtx?.before ?? [],
        sourceAfter: sourceCtx?.after ?? [],
        targetBefore: targetCtx.before,
        targetAfter: targetCtx.after,
      };
    } catch {
      surroundings = undefined;
    }
    const columnHeader = columnHeaderAt(anchorRange.from);
    const currentTargetUnitText = $from.parent.textContent;
    const initialAlignment = resolveInitialAlignedSourceRange({
      sourceUnitText,
      targetUnitText: currentTargetUnitText,
      targetSelectionStart: $from.parentOffset,
      targetSelectionEnd: $to.parentOffset,
    });
    setSelectionEdit({
      selection,
      mode,
      sourceUnitText,
      sourceText: initialAlignment.text,
      sourceAlignmentPrecision: initialAlignment.precision,
      currentTargetUnitText,
      ...(surroundings ? { surroundings } : {}),
      ...(columnHeader ? { columnHeader } : {}),
      instruction: selectionInstructionRef.current,
      // 번역사는 한 문서에서 같은 참조 범위로 여러 문장을 고친다. 선택마다 초기화하면
      // 매번 같은 선택을 반복해야 하므로 프로젝트 안에서는 직전 설정을 유지한다.
      referenceOptions: { ...selectionReferenceOptionsRef.current },
      replacementText: '',
      contextManifest: undefined,
      flattenFormatting,
      loading: false,
      error: null,
    });
  }, [createChatSelection, addToast, t]);

  const closeSelectionEdit = useCallback((): void => {
    selectionEditAbortRef.current?.abort();
    selectionEditAbortRef.current = null;
    // 실패·취소 포함 어떤 경로로 닫혀도 앵커(하이라이트)를 함께 정리한다.
    if (selectionEdit) {
      const editor = targetEditorRef.current;
      if (editor) removeSelectionAnchor(editor, selectionEdit.selection.anchorId);
    }
    setSelectionEdit(null);
  }, [selectionEdit]);

  const generateSelectionEdit = useCallback(async (): Promise<void> => {
    const request = selectionEdit;
    if (!request || !project) return;
    const requestProjectId = project.id;
    const controller = new AbortController();
    selectionEditAbortRef.current?.abort();
    selectionEditAbortRef.current = controller;
    setSelectionEdit((current) => current ? {
      ...current,
      replacementText: '',
      // 재생성에서 이전 제안을 남겨두면 새 결과가 도착할 때까지 낡은 것이 새 것처럼 보인다.
      ...(current.cells
        ? { cells: current.cells.map((cell) => ({ ...cell, replacementText: '' })) }
        : {}),
      loading: true,
      error: null,
    } : null);
    // 실제로 실행한 지시문만 최근 목록에 남긴다 (입력만 하고 닫은 것은 제외).
    useInstructionHistoryStore.getState().recordInstruction(
      requestProjectId,
      request.mode === 'polish' ? 'selectionPolish' : 'selectionRetranslate',
      request.instruction,
    );

    try {
      const memory = useProjectMemoryStore.getState();
      const legacyProjectContextAtStart = useChatStore.getState().projectContext;
      const glossaryEntries = request.referenceOptions.glossary
        ? await resolveGlossaryEntries({
            projectId: requestProjectId,
            text: request.sourceText,
            domain: project.metadata.domain,
            limit: 12,
          })
        : [];
      const contextSnapshot = buildContextSnapshot({
        revision: memory.revision,
        projectMemoryItems: memory.items,
        legacyProjectContext: legacyProjectContextAtStart,
        translationRules,
        forbiddenTerms: memory.forbiddenTerms,
        glossaryEntries,
      });
      if (request.cells) {
        const requestCells = request.cells;
        const runSegments = request.mode === 'polish' ? polishSegments : retranslateSegments;
        const cellResult = await runSegments({
          projectId: requestProjectId,
          segments: requestCells.map((cell) => ({
            ...(cell.sourceText ? { sourceText: cell.sourceText } : {}),
            currentTargetText: cell.currentText,
            ...(cell.columnHeader ? { columnHeader: cell.columnHeader } : {}),
          })),
          targetLanguage: resolveTargetLanguageNow() ?? 'Target',
          ...(request.instruction.trim() ? { instruction: request.instruction.trim() } : {}),
          referenceOptions: request.referenceOptions,
          contextSnapshot,
          abortSignal: controller.signal,
          onToken: (replacements) => {
            setSelectionEdit((current) =>
              current?.selection.selectionId === request.selection.selectionId && current.cells
                ? {
                    ...current,
                    cells: current.cells.map((cell, index) => ({
                      ...cell,
                      replacementText: replacements[index] ?? '',
                    })),
                  }
                : current,
            );
          },
        });
        if (
          controller.signal.aborted ||
          useProjectStore.getState().project?.id !== requestProjectId
        ) return;
        setSelectionEdit((current) =>
          current?.selection.selectionId === request.selection.selectionId && current.cells
            ? {
                ...current,
                cells: current.cells.map((cell, index) => ({
                  ...cell,
                  replacementText: cellResult.replacements[index] ?? '',
                })),
                contextManifest: cellResult.contextManifest,
                loading: false,
                error: null,
              }
            : current,
        );
        return;
      }
      const commonInput = {
        projectId: requestProjectId,
        currentTargetUnitText: request.currentTargetUnitText,
        currentTargetText: request.selection.text,
        targetLanguage: resolveTargetLanguageNow() ?? 'Target',
        ...(request.surroundings ? { surroundings: request.surroundings } : {}),
        ...(request.columnHeader ? { columnHeader: request.columnHeader } : {}),
        ...(request.instruction.trim() ? { instruction: request.instruction.trim() } : {}),
        referenceOptions: request.referenceOptions,
        contextSnapshot,
        abortSignal: controller.signal,
        onToken: (text: string) => {
          setSelectionEdit((current) =>
            current?.selection.selectionId === request.selection.selectionId
              ? { ...current, replacementText: text }
              : current,
          );
        },
      };
      // 폴리싱은 원문 구절을 다시 좁히지 않는다 — 원문은 의미를 고정하는 참조일 뿐이고,
      // 짝을 못 찾았으면 없이 간다. 그래서 대응(alignment)은 재번역에서만 채워진다.
      type SourceAlignmentUpdate = {
        sourceText: string;
        sourceAlignmentPrecision: SourceAlignmentPrecision;
      };
      const result = request.mode === 'polish'
        ? await polishSelection({
            ...commonInput,
            ...(request.sourceUnitText.trim()
              ? { sourceText: request.sourceUnitText }
              : {}),
          }).then((polished) => ({
            replacementText: polished.replacementText,
            contextManifest: polished.contextManifest,
            alignment: null as SourceAlignmentUpdate | null,
          }))
        : await retranslateSelection({
            ...commonInput,
            sourceText: request.sourceUnitText,
            suggestedSourceText: request.sourceText,
            suggestedAlignmentPrecision: request.sourceAlignmentPrecision,
          }).then((retranslated) => ({
            replacementText: retranslated.replacementText,
            contextManifest: retranslated.contextManifest,
            alignment: {
              sourceText: retranslated.alignedSourceText,
              sourceAlignmentPrecision: retranslated.alignmentPrecision,
            } as SourceAlignmentUpdate | null,
          }));
      if (
        controller.signal.aborted ||
        useProjectStore.getState().project?.id !== requestProjectId
      ) return;
      setSelectionEdit((current) =>
        current?.selection.selectionId === request.selection.selectionId
          ? {
              ...current,
              ...(result.alignment ?? {}),
              replacementText: result.replacementText,
              contextManifest: result.contextManifest,
              loading: false,
              error: null,
            }
          : current,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setSelectionEdit((current) => current ? {
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      } : null);
    } finally {
      if (selectionEditAbortRef.current === controller) {
        selectionEditAbortRef.current = null;
      }
    }
  }, [selectionEdit, project, translationRules]);

  const applyCurrentSelectionEdit = useCallback((
    selectedCellIndexes?: ReadonlySet<number>,
  ): void => {
    const request = selectionEdit;
    const editor = targetEditorRef.current;
    if (!request || !editor || project?.id !== request.selection.projectId) {
      setSelectionEdit((current) => current ? {
        ...current,
        error: t('selection.projectChanged', '프로젝트가 바뀌어 적용할 수 없습니다.'),
      } : null);
      return;
    }
    // 고르지 않은 블록과 **제안이 안 온 블록**은 `null`. 빈 문자열로 넘기면 그 블록이
    // 지워진다 — 스트리밍이 끊겨 일부만 채워진 결과를 그대로 적용하면 멀쩡한 번역문이
    // 사라진다. 모달도 같은 기준으로 고르지 못하게 하지만, 지우는 쪽에서 한 번 더 막는다.
    const cellReplacements = request.cells
      ? request.cells.map((cell, index) =>
          cell.replacementText && (!selectedCellIndexes || selectedCellIndexes.has(index))
            ? cell.replacementText
            : null,
        )
      : null;
    // 검사 대상은 실제로 들어갈 텍스트뿐이다 — 뺀 블록의 금칙어까지 적용을 막지 않는다.
    const proposedTexts = cellReplacements
      ? cellReplacements.filter((text): text is string => text !== null)
      : [request.replacementText];
    // 참조 옵션을 바꿔도 결과가 유지되므로(생성 뒤에 체크박스를 켤 수 있다), 금칙어
    // 검사는 생성 시점 스냅샷이 아니라 **지금 켜둔 설정과 현재 금칙어 목록**을 따른다.
    const forbiddenTerms = request.referenceOptions.forbiddenTerms
      ? useProjectMemoryStore.getState().forbiddenTerms.filter((term) => term.enabled)
      : [];
    const violatedTerm = forbiddenTerms.find((term) =>
      proposedTexts.some((text) =>
        text.toLocaleLowerCase().includes(term.term.toLocaleLowerCase()),
      ),
    );
    if (violatedTerm) {
      setSelectionEdit((current) => current ? {
        ...current,
        error: t('selection.forbiddenTermViolation', {
          term: violatedTerm.term,
          defaultValue: `수정안에 금칙어 “${violatedTerm.term}”이 포함되어 있습니다.`,
        }),
      } : null);
      return;
    }
    const anchor = resolveSelectionAnchor(editor, request.selection.anchorId);
    if (!anchor) {
      setSelectionEdit((current) => current ? {
        ...current,
        error: t('selection.reselectRequired', '문서가 변경되었습니다. 영역을 다시 선택해주세요.'),
      } : null);
      return;
    }
    const anchorRange = getSingleAnchorRange(anchor);
    // 여러 셀은 범위마다 코멘트를 모은다 — 사이에 낀, 고르지 않은 셀의 코멘트가 섞이면
    // 안 되므로 span 하나로 훑지 않는다.
    const affectedCommentIds = cellReplacements
      ? [...new Set(anchor.ranges.flatMap((range, index) =>
          cellReplacements[index] === null
            ? []
            : collectCommentIdsInRange(editor.state.doc, range.from, range.to),
        ))]
      : anchorRange
        ? collectCommentIdsInRange(editor.state.doc, anchorRange.from, anchorRange.to)
        : [];
    const result = request.cells && cellReplacements
      ? applySelectionEdits(
          editor,
          anchor,
          cellReplacements,
          {
            // 재번역이 만들어진 시점(모달 오픈)의 셀별 텍스트를 기준으로 검증한다.
            expectedTexts: request.cells.map((cell) => cell.currentText),
            flattenFormatting: request.flattenFormatting,
          },
        )
      : applySelectionEdit(editor, anchor, request.replacementText, {
          // 재번역이 만들어진 시점(모달 오픈)의 선택 텍스트를 기준으로 검증한다.
          expectedText: request.selection.text,
          flattenFormatting: request.flattenFormatting,
        });
    if (result !== 'applied') {
      setSelectionEdit((current) => current ? {
        ...current,
        error: result === 'formatting-conflict'
          ? t(
              'selection.mixedFormattingUnsupported',
              '서로 다른 서식이 섞인 범위는 재번역할 수 없습니다. 같은 서식 안에서 다시 선택해주세요.',
            )
          : t('selection.reselectRequired', '문서가 변경되었습니다. 영역을 다시 선택해주세요.'),
      } : null);
      return;
    }
    syncCommentExcerpts(editor, affectedCommentIds);
    if (affectedCommentIds.length > 0) {
      void useProjectStore.getState().saveProject();
    }
    closeSelectionEdit();
  }, [selectionEdit, project?.id, t, closeSelectionEdit]);

  const openCommentDetail = useCallback((params: {
    commentId: string;
    editor: Editor;
    field: CommentField;
    top: number;
    left: number;
  }): void => {
    setSelectionToolbar(null);
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
        ranges: SelectionRange[];
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
      // 표 다중 셀 선택은 범위가 여러 개다 — 하나의 span으로 칠하면 고르지 않은
      // 셀까지 마킹된다. 한 chain(=한 transaction)에서 범위마다 적용한다.
      ctx.ranges
        .reduce(
          (chain, range) => chain.setTextSelection(range).setComment(created.id),
          ctx.editor.chain().focus(),
        )
        .run();

      // 코멘트 본문 영속(프로젝트 저장 경로에서 commentStore를 함께 저장)
      void useProjectStore.getState().saveProject();

      setCommentPopover(null);
    },
    [],
  );

  const openTranslatePreview = useCallback(async (
    extraMessage?: string,
    options?: { continuationPlan?: ContinuationPlan },
  ): Promise<void> => {
    if (!project) return;
    if (!sourceEditorRef.current) {
      addToast({ type: 'error', message: t('editor.sourceEditorNotReady', 'Source 에디터가 아직 준비되지 않았습니다.') });
      return;
    }

    // 빈 문서 검증: 텍스트 콘텐츠가 없으면 번역 불필요
    // (자동 방향 판정이 원문을 재료로 쓰므로 언어 검증보다 먼저 본다)
    if (sourceEditorRef.current.isEmpty) {
      addToast({ type: 'warning', message: t('editor.emptySource', '번역할 원문이 없습니다. 원문을 먼저 입력해주세요.') });
      return;
    }

    // 방향 확정: '자동'이면 원문 감지로 풀고, 못 풀면 명시 선택을 요구한다.
    const sourceText = sourceEditorRef.current.getText();
    const resolvedTargetLanguage = resolveTargetLanguage(project.metadata.targetLanguage, sourceText).language;
    if (!resolvedTargetLanguage) {
      addToast({ type: 'warning', message: t('editor.autoTargetLanguageFailed') });
      return;
    }

    // 원문과 같은 언어로 번역시키면 모델이 원문을 되받아쓴다 — 명시 선택일 때만 걸린다
    // (자동으로 푼 값은 정의상 원문의 반대 언어라 여기 걸릴 수 없다).
    if (isSameLanguage(detectSourceLanguage(sourceText), resolvedTargetLanguage)) {
      addToast({
        type: 'warning',
        message: t('editor.targetLanguageSameAsSource', {
          language: localizeLanguage(t, resolvedTargetLanguage),
        }),
      });
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
      // 재번역 diff의 기준 스냅샷. 요청 시점 target을 캡처해 두면 변경사항 탭에서
      // 문단 단위 선택 적용이 가능해진다(첫 번역은 비교 대상이 없으므로 null).
      // requestMeta.targetRevision과 같은 시점의 문서다 — 적용 시 L2 가드가
      // 이 스냅샷이 여전히 유효한지 보장한다.
      const targetEditor = targetEditorRef.current;
      const targetDocJsonAtStart =
        targetEditor && !targetEditor.isDestroyed && !targetEditor.isEmpty
          ? (targetEditor.getJSON() as TipTapDocJson)
          : null;
      setTranslateOriginalDocJson(targetDocJsonAtStart);

      // 이어서 번역: 모델에 보내는 건 남은 뒷부분 sub-doc뿐이고, 결과는 기준
      // 스냅샷 뒤에 이어 붙여 완성본으로 프리뷰한다(부분 적용을 만들지 않는다).
      const continuationPlan = options?.continuationPlan;
      if (continuationPlan && !targetDocJsonAtStart) {
        // 이어 붙일 기준이 없으면 병합할 수 없다 — 조용히 전체 번역으로 흘리지 않는다.
        throw new Error(t('editor.continueTranslateNoBase'));
      }
      const translationSourceDocJson = continuationPlan
        ? continuationPlan.remainingSourceDoc
        : sourceDocJson;

      const memoryAtStart = useProjectMemoryStore.getState();
      const legacyProjectContextAtStart = useChatStore.getState().projectContext;

      // 용어집 검색 (앞부분만이 아니라 문서 전역 윈도우).
      // 이어서 번역은 실제로 번역할 구간에서만 찾는다 — 앞부분 용어는 이미 확정됐고
      // 참고 쌍으로 문체가 전달된다.
      let glossaryEntries: Awaited<ReturnType<typeof resolveGlossaryEntries>> = [];
      try {
        const sourceMarkdown = tipTapJsonToMarkdown(translationSourceDocJson);
        if (sourceMarkdown.trim().length > 0) {
          glossaryEntries = await resolveGlossaryEntries({
            projectId: project.id,
            text: sourceMarkdown,
            domain: project.metadata.domain,
            limit: 30,
          });
          if (glossaryEntries.length > 0) {
            console.warn(`[Translation] Glossary injected`);
          }
        }
      } catch (glossaryError) {
        // 용어집 검색 실패는 조용히 무시 (번역은 계속 진행)
        console.warn('[Translation] Glossary search failed:', glossaryError);
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

      const trimmedMessage = extraMessage?.trim();
      useInstructionHistoryStore.getState().recordInstruction(
        project.id,
        'documentRetranslate',
        trimmedMessage ?? '',
      );
      // 인라인 코멘트 → excerpt 직렬화 후 주입 (source/target 양쪽 모두 번역 맥락으로 전달)
      const serializedComments = serializeUserComments(
        useCommentStore.getState().comments,
      );
      const { doc } = await translateWithStreaming({
        project,
        sourceDocJson: translationSourceDocJson,
        resolvedContext,
        ...(serializedComments ? { userComments: serializedComments } : {}),
        ...(trimmedMessage ? { retranslateMessage: trimmedMessage } : {}),
        ...(continuationPlan
          ? { continuation: { contextPairs: continuationPlan.contextPairs } }
          : {}),
        // 스트리밍 탭에는 신규 번역분만 흐른다(병합 전) — 의도된 동작.
        // 완성본은 아래에서 병합해 프리뷰/변경사항 탭으로 넘긴다.
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
      // 병합-후-전체-교체: 이어서 번역은 기준 스냅샷 + 신규 번역분의 완성본을 프리뷰한다.
      // 이 스냅샷의 유효성은 적용 시점 L2 리비전 가드가 보장한다.
      setTranslatePreviewDoc(
        continuationPlan && targetDocJsonAtStart
          ? appendTopLevelBlocks(targetDocJsonAtStart, doc)
          : doc,
      );
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
    addToast,
    t,
    computeTargetRevision,
    setStreamingChannelText,
    setTranslateLoading,
  ]);

  // 번역 버튼 클릭 핸들러: 타겟에 내용이 있으면 재번역 모달 먼저 표시
  const handleTranslateClick = useCallback(() => {
    const sourceEd = sourceEditorRef.current;
    if (!sourceEd) return;
    const hasTarget = stripHtml(targetDocument || '').trim().length > 0;
    if (hasTarget) {
      // 모달을 여는 시점의 두 문서로 경계를 판정한다. 실패해도 재번역은 그대로 가능하다.
      const targetEd = targetEditorRef.current;
      setContinuationPlanResult(
        !sourceEd.isDestroyed && targetEd && !targetEd.isDestroyed
          ? buildContinuationPlan(
              sourceEd.getJSON() as TipTapDocJson,
              targetEd.getJSON() as TipTapDocJson,
            )
          : null,
      );
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

  const openPolishPreview = useCallback(async (
    extraMessage?: string,
    options?: { scope?: AiSelectionScope },
  ): Promise<void> => {
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
      const memoryAtStart = useProjectMemoryStore.getState();
      const legacyProjectContextAtStart = useChatStore.getState().projectContext;
      // diff 기준은 언제나 **전체** target이다 — 범위 실행이어도 프리뷰는 완성본을 보여준다.
      setPolishOriginalDocJson(targetDocJson);

      // 범위 실행: 고른 구간만 모델에 보내고, 결과를 그 자리에 되돌려 놓는다.
      // 표 안 선택은 최상위 블록(=표 전체)이 아니라 유효한 작은 표 / 셀 안 문단을 보낸다 —
      // 깨진 표를 보내지 않으면서도 표의 나머지 칸은 불변이다.
      const scope = options?.scope;
      const targetContent = Array.isArray(targetDocJson.content) ? targetDocJson.content : [];
      if (scope?.kind === 'top-level-blocks' && scope.toIndex >= targetContent.length) {
        // 모달을 여는 사이 문서가 줄었다 — 잘못된 구간에 결과를 넣지 않는다.
        throw new Error(t('editor.polishScopeStale'));
      }
      let polishInputDocJson: TipTapDocJson = targetDocJson;
      if (scope?.kind === 'top-level-blocks') {
        polishInputDocJson = {
          ...targetDocJson,
          content: targetContent.slice(scope.fromIndex, scope.toIndex + 1),
        };
      } else if (scope) {
        try {
          polishInputDocJson = scope.kind === 'table-rect'
            ? extractTableRectDoc(targetDocJson, scope.tableIndex, scope.rect)
            : extractBlockDoc(targetDocJson, scope.blockPath);
        } catch {
          // 모달을 여는 사이 표가 바뀌었다 — 다시 선택하게 한다.
          throw new Error(t('editor.polishScopeStale'));
        }
      }
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
      let glossaryEntries: Awaited<ReturnType<typeof resolveGlossaryEntries>> = [];
      try {
        const sourceMarkdown = sourceEditorRef.current
          ? tipTapJsonToMarkdown(sourceEditorRef.current.getJSON() as Record<string, unknown>)
          : '';
        const targetMarkdown = tipTapJsonToMarkdown(targetDocJson as Record<string, unknown>);
        const searchText = [sourceMarkdown, targetMarkdown].filter((part) => part.trim()).join('\n');
        if (searchText.trim().length > 0) {
          glossaryEntries = await resolveGlossaryEntries({
            projectId: project.id,
            text: searchText,
            domain: project.metadata.domain,
            limit: 30,
          });
        }
      } catch (glossaryError) {
        console.warn('[Polish] Glossary search failed:', glossaryError);
      }
      const resolvedContext = resolveWorkflowContextFromSnapshot({
        mode: 'polish',
        snapshot: buildContextSnapshot({
          revision: memoryAtStart.revision,
          projectMemoryItems: memoryAtStart.items,
          legacyProjectContext: legacyProjectContextAtStart,
          translationRules,
          forbiddenTerms: memoryAtStart.forbiddenTerms,
          glossaryEntries,
        }),
      });

      useInstructionHistoryStore.getState().recordInstruction(
        project.id,
        'documentPolish',
        trimmedMessage ?? '',
      );
      const { doc } = await polishTargetDocumentWithStreaming({
        targetDocJson: polishInputDocJson,
        targetLanguage: resolveTargetLanguageNow() ?? undefined,
        resolvedContext,
        ...(serializedComments ? { userComments: serializedComments } : {}),
        ...(trimmedMessage ? { polishMessage: trimmedMessage } : {}),
        onToken: (text) => setStreamingChannelText('polish', text),
        abortSignal: abortController.signal,
      });
      // L2: 완료 시점 재검증 (취소/전환/새 요청 시작 시 결과 폐기)
      if (abortController.signal.aborted) return;
      if (polishAbortController.current !== abortController) return;
      if (useProjectStore.getState().project?.id !== requestMeta.projectId) return;
      // 병합-후-전체-교체: 구간 결과를 요청 시점 스냅샷에 끼워 완성본으로 프리뷰한다.
      // 스냅샷의 유효성은 적용 시점 L2 리비전 가드가 보장한다.
      // 표 병합의 키는 translationUnitId가 아니라 표 기하(rect·경로)다 — 모델이 셀 ID를
      // 버려도 칸 위치로는 되돌려 놓을 수 있다.
      setPolishPreviewDoc(
        !scope
          ? doc
          : scope.kind === 'top-level-blocks'
            ? replaceTopLevelBlockRange(targetDocJson, scope.fromIndex, scope.toIndex, doc)
            : scope.kind === 'table-rect'
              ? replaceTableRect(targetDocJson, scope.tableIndex, scope.rect, doc)
              : replaceBlockAtPath(targetDocJson, scope.blockPath, doc),
      );
      setStreamingChannelText('polish', null);
    } catch (error) {
      // stale 요청이 새 요청의 상태를 덮지 않도록 가드
      if (polishAbortController.current !== abortController) return;
      if (abortController.signal.aborted) {
        setPolishPreviewError(t('editor.polishCancelled', '폴리싱이 취소되었습니다.'));
      } else if (error instanceof TableStructureMismatchError) {
        // 모델이 행·열을 바꿔 고른 칸에 되돌려 놓을 수 없다 — 적용 없이 안내만.
        setPolishPreviewError(t('editor.polishScopeStructureChanged'));
      } else {
        setPolishPreviewError(formatTranslationError(error));
      }
    } finally {
      if (polishAbortController.current === abortController) {
        setPolishLoading(false);
        polishAbortController.current = null;
      }
    }
  }, [addToast, hasTargetContent, project, t, translationRules, computeTargetRevision, setStreamingChannelText, setPolishLoading]);

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
    // 모달을 여는 시점의 선택을 구간으로 굳힌다 — 모달로 포커스가 옮겨가면
    // 에디터 선택이 흐려지므로 실행 시점에 다시 읽을 수 없다.
    setPolishScope(resolveAiSelectionScope(targetEditorRef.current));
    setPolishScopeEnabled(true);
    setPolishMessage('');
    setPolishModalOpen(true);
  }, [addToast, hasTargetContent, project, t]);

  // 상단 툴바(WorkflowActions)의 실행 요청 수신.
  // 번역/폴리싱 로직은 양쪽 TipTap 인스턴스와 프리뷰 모달에 묶여 있어 여기 남기고,
  // 툴바는 nonce만 올린다 (reviewStore.reviewTrigger ← ReviewPanel 과 동일 패턴).
  const translateTrigger = useUIStore((s) => s.translateTrigger);
  const polishTrigger = useUIStore((s) => s.polishTrigger);
  const prevTranslateTriggerRef = useRef(translateTrigger);
  const prevPolishTriggerRef = useRef(polishTrigger);

  useEffect(() => {
    if (translateTrigger > prevTranslateTriggerRef.current) {
      handleTranslateClick();
    }
    prevTranslateTriggerRef.current = translateTrigger;
  }, [translateTrigger, handleTranslateClick]);

  useEffect(() => {
    if (polishTrigger > prevPolishTriggerRef.current) {
      handlePolishClick();
    }
    prevPolishTriggerRef.current = polishTrigger;
  }, [polishTrigger, handlePolishClick]);

  // 번역 취소 핸들러
  const handleTranslateCancel = useCallback((): void => {
    if (translateAbortController.current) {
      translateAbortController.current.abort();
    }
    setTranslateLoading(false);
    setTranslatePreviewOpen(false);
    setTranslateOriginalDocJson(null);
    setStreamingChannelText('translate', null);
  }, [setStreamingChannelText, setTranslateLoading]);

  const applyTranslateDoc = useCallback((doc: TipTapDocJson): void => {
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
      setTranslateOriginalDocJson(null);
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
    replaceDocContent(targetEditorRef.current, doc, { addToHistory: true });
    setTranslatePreviewOpen(false);
    setTranslateOriginalDocJson(null);

    // Flash 효과 트리거 (1초 동안 지속)
    setTargetFlash(true);
    setTimeout(() => setTargetFlash(false), 1000);

    // 번역 적용 후 자동 스냅샷
    const { project, materializeBlocksForSnapshot } = useProjectStore.getState();
    if (project) {
      const blocks = materializeBlocksForSnapshot();
      if (blocks) {
        const model = getModelIdForUse('translation');
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
  }, [addToast, t, createSnapshotIfChanged, computeTargetRevision]);

  const applyTranslatePreview = useCallback((): void => {
    if (!translatePreviewDoc) return;
    applyTranslateDoc(translatePreviewDoc);
  }, [translatePreviewDoc, applyTranslateDoc]);

  const handlePolishCancel = useCallback((): void => {
    if (polishAbortController.current) {
      polishAbortController.current.abort();
    }
    setPolishLoading(false);
    setPolishPreviewOpen(false);
    setStreamingChannelText('polish', null);
  }, [setStreamingChannelText, setPolishLoading]);

  // 폴리싱 미리보기 종료 시 스냅샷 상태를 함께 정리 (ReviewPanel handleRetranslateClose와 대칭).
  // 재열기 경로가 항상 재스냅샷하므로 correctness 이슈는 아니지만, 문서 JSON 상주를 방지한다.
  const handlePolishClose = useCallback((): void => {
    setPolishPreviewOpen(false);
    setPolishPreviewDoc(null);
    setPolishOriginalDocJson(null);
    setPolishPreviewError(null);
    setPolishScope(null);
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

    replaceDocumentWithAppliedChanges(targetEditorRef.current, doc, { addToHistory: true });
    handlePolishClose();

    const { project, materializeBlocksForSnapshot } = useProjectStore.getState();
    if (project) {
      const blocks = materializeBlocksForSnapshot();
      if (blocks) {
        const model = getModelIdForUse('polish');
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
  }, [addToast, t, createSnapshotIfChanged, handlePolishClose, computeTargetRevision]);

  const applyPolishPreview = useCallback((): void => {
    if (!polishPreviewDoc) return;
    applyPolishDoc(polishPreviewDoc);
  }, [polishPreviewDoc, applyPolishDoc]);

  // 번역 재시도 핸들러
  const handleTranslateRetry = useCallback((): void => {
    void openTranslatePreview(retranslateMessage);
  }, [openTranslatePreview, retranslateMessage]);

  /** 모달 실행 경로 — 체크박스 상태를 스코프 옵션으로 옮긴다 (재시도도 같은 범위를 쓴다). */
  const activePolishScope = polishScopeEnabled ? polishScope : null;

  const runPolishFromModal = useCallback((): void => {
    void openPolishPreview(polishMessage, activePolishScope ? { scope: activePolishScope } : {});
  }, [openPolishPreview, polishMessage, activePolishScope]);

  const handlePolishRetry = useCallback((): void => {
    void openPolishPreview(polishMessage, activePolishScope ? { scope: activePolishScope } : {});
  }, [openPolishPreview, polishMessage, activePolishScope]);

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
    // 선택 영역 재번역 모달도 함께 정리 (전환 후 영구 로딩/오적용 방지).
    // 앵커는 프로젝트 문서 교체(replaceDocContent의 documentReplace meta)가 clear한다.
    selectionEditAbortRef.current?.abort();
    selectionEditAbortRef.current = null;
    setSelectionEdit(null);
    setSelectionToolbar(null);
    selectionReferenceOptionsRef.current = { ...DEFAULT_SELECTION_REFERENCE_OPTIONS };
    selectionInstructionRef.current = '';
    // 지시사항은 프로젝트의 스타일·용어 결정이라 다른 프로젝트로 넘기지 않는다.
    // 입력칸을 열어보기 전에는 눈치챌 수 없어 조용히 결과에 섞이기 때문.
    setRetranslateModalOpen(false);
    setRetranslateMessage('');
    setPolishModalOpen(false);
    setPolishMessage('');
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
  }, [project?.id, setStreamingChannelText, setTranslateLoading, setPolishLoading]);

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
      await writeRichClipboard({ html, markdown });
      addToast({ type: 'success', message: t('common.copied', '클립보드에 복사되었습니다.') });
    } catch {
      addToast({ type: 'error', message: t('common.copyError', '복사에 실패했습니다.') });
    }
  }, [addToast, t]);

  const handleCopySource = useCallback(() => copyEditorContent(sourceEditorRef.current), [copyEditorContent]);
  const handleCopyTarget = useCallback(() => copyEditorContent(targetEditorRef.current), [copyEditorContent]);

  // 상대 패널 위치 맞추기: 누른 패널 뷰포트 최상단 유닛의 대응 유닛을 찾아
  // 반대쪽 패널을 같은 뷰포트 오프셋으로 스크롤한다. 최상단 유닛이 ID가 없거나
  // 대응이 안 잡히면(legacy 문서·추가/삭제 문단) 아래쪽 유닛으로 넘어간다.
  const alignCounterpartScroll = useCallback((primary: 'source' | 'target') => {
    const primaryEditor = primary === 'source' ? sourceEditorRef.current : targetEditorRef.current;
    const counterpartEditor = primary === 'source' ? targetEditorRef.current : sourceEditorRef.current;
    if (!primaryEditor || !counterpartEditor) {
      addToast({
        type: 'error',
        message: t('editor.alignScrollNotReady', '두 패널이 모두 준비되어야 위치를 맞출 수 있습니다.'),
      });
      return;
    }
    const primaryScroll = primaryEditor.view.dom as HTMLElement;
    const counterpartScroll = counterpartEditor.view.dom as HTMLElement;
    const primaryRect = primaryScroll.getBoundingClientRect();
    // 후보를 화면에 실제로 보이는 범위로 끊는다. 문서 끝까지 후보로 두면 ID 매칭이
    // 안 되는 legacy 문서에서 짝을 못 찾을 때마다 유닛 수만큼 LCS 정렬을 반복해
    // UI가 멈춘다. 보이는 화면 안에 짝이 하나도 없으면 그냥 실패로 알린다.
    const visibleUnitEls = Array.from(
      primaryScroll.querySelectorAll<HTMLElement>('[data-translation-unit-id]'),
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > primaryRect.top && rect.top < primaryRect.bottom;
    });
    const primaryDoc = primaryEditor.getJSON() as TranslationUnitDocument;
    const counterpartDoc = counterpartEditor.getJSON() as TranslationUnitDocument;
    for (const unitEl of visibleUnitEls) {
      const unitId = unitEl.getAttribute('data-translation-unit-id');
      if (!unitId) continue;
      const counterpartId = findAlignedCounterpartUnits(counterpartDoc, primaryDoc, [unitId])
        .find((unit) => unit.id)?.id;
      if (!counterpartId) continue;
      const counterpartEl = counterpartScroll.querySelector<HTMLElement>(
        `[data-translation-unit-id="${CSS.escape(counterpartId)}"]`,
      );
      if (!counterpartEl) continue;
      const viewportOffset = unitEl.getBoundingClientRect().top - primaryRect.top;
      const counterpartRect = counterpartScroll.getBoundingClientRect();
      const top =
        counterpartEl.getBoundingClientRect().top -
        counterpartRect.top +
        counterpartScroll.scrollTop -
        viewportOffset;
      counterpartScroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      return;
    }
    addToast({
      type: 'error',
      message: t('editor.alignScrollNoCounterpart', '대응하는 유닛을 찾을 수 없습니다.'),
    });
  }, [addToast, t]);

  const handleAlignFromSource = useCallback(() => alignCounterpartScroll('source'), [alignCounterpartScroll]);
  const handleAlignFromTarget = useCallback(() => alignCounterpartScroll('target'), [alignCounterpartScroll]);

  const handleCopySelection = useCallback(async (bubble: SelectionBubble): Promise<void> => {
    if (!bubble.text.trim()) {
      addToast({ type: 'error', message: t('common.copyError', '복사할 내용이 없습니다.') });
      return;
    }

    try {
      const content = serializeSelectionForClipboard(bubble.editor, bubble.slice);
      await writeRichClipboard(content);
      addToast({ type: 'success', message: t('common.copied', '클립보드에 복사되었습니다.') });
    } catch {
      addToast({ type: 'error', message: t('common.copyError', '복사에 실패했습니다.') });
    }
  }, [addToast, t]);

  // Source/Target 중 포커스된 에디터의 selection watcher를 연결
  useEffect(() => {
    const cleaners: Array<() => void> = [];
    if (sourceEditor) cleaners.push(attachSelectionWatcher(sourceEditor, 'source'));
    if (targetEditor) cleaners.push(attachSelectionWatcher(targetEditor, 'target'));
    return () => {
      cleaners.forEach((fn) => fn());
    };
  }, [sourceEditor, targetEditor, attachSelectionWatcher]);

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
  const isAlignmentMode = editorViewMode === 'alignment';

  return (
    <div className="flex-1 h-full min-h-0 flex flex-col min-w-0 bg-editor-surface">
      {/* 상태 스트립 — 워크플로 액션이 Toolbar로 올라간 자리를 진행/저장/스냅샷/단어수가 대신한다.
          양 끝은 숨긴 사이드바 되살림 버튼(바 내부엔 UI가 없어 여기 노출). */}
      {/* 밴드 1 (36px) — UnifiedSidebar 탭 바, AlignmentView 헤더와 같은 선 */}
      <div className={`${BAND_1} px-2 flex items-center gap-2 border-b border-editor-hairline shrink-0`}>
        {leftSidebarInvisible && (
          <button
            type="button"
            onClick={revealLeftSidebar}
            className="p-1 rounded-md text-editor-muted hover:text-editor-text hover:bg-editor-border transition-colors shrink-0"
            title={t('sidebar.showLeft', 'Show side panel')}
            aria-label={t('sidebar.showLeft', 'Show side panel')}
            data-testid="reveal-sidebar-left"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}
        {/* 보기 모드 — 문서 보기(편집) ↔ 정렬 검사(읽기 전용 대조) */}
        <div
          className="flex items-center shrink-0 rounded-md border border-editor-border overflow-hidden"
          role="group"
          aria-label={t('editor.viewMode.label')}
        >
          {([
            { mode: 'document' as const, label: t('editor.viewMode.document') },
            { mode: 'alignment' as const, label: t('editor.viewMode.alignment') },
          ]).map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setEditorViewMode(mode)}
              aria-pressed={editorViewMode === mode}
              className={`h-[26px] px-3 text-xs active:scale-95 transition-colors ${
                editorViewMode === mode
                  ? 'bg-primary-fill text-white font-semibold'
                  : 'font-semibold text-editor-muted hover:bg-editor-border'
              }`}
              data-testid={`editor-view-mode-${mode}`}
            >
              {label}
            </button>
          ))}
        </div>
        <StatusStrip />
        {rightSidebarInvisible && (
          <button
            type="button"
            onClick={revealRightSidebar}
            className="p-1 rounded-md text-editor-muted hover:text-editor-text hover:bg-editor-border transition-colors shrink-0"
            title={t('sidebar.showRight', 'Show chat panel')}
            aria-label={t('sidebar.showRight', 'Show chat panel')}
            data-testid="reveal-sidebar-right"
          >
            <PanelRightOpen className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Editor Panels */}
      <div className="flex-1 min-h-0 min-w-0 relative">
      {/* 정렬 검사 모드에서도 PanelGroup을 언마운트하지 않는다 — 언마운트하면 TipTap
          인스턴스가 파괴되고 editorStore가 비어 점프·검수 적용이 깨진다.
          visibility:hidden은 레이아웃을 유지하므로 스크롤 위치가 보존되고, 숨은 동안
          contenteditable이 포커스를 받을 수 없어 읽기 전용도 함께 강제된다. */}
      <div
        className="h-full min-h-0 min-w-0"
        style={isAlignmentMode ? { visibility: 'hidden' } : undefined}
      >
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
                {/* 밴드 2 (34px) — 섹션 캡션. 색상 대신 위계(캡션 타이포)로 구분한다 */}
                <div className={`${BAND_2} px-4 flex items-center justify-between border-b border-editor-hairline bg-editor-bg`}>
                  <div className="flex items-center gap-2">
                    <span className={CAPTION}>
                      {t('editor.source').toUpperCase()}
                    </span>
                    {sourceOnlyMode ? (
                      <button
                        type="button"
                        onClick={toggleSourceOnlyMode}
                        className="px-1.5 py-0.5 rounded text-xs text-editor-muted hover:text-editor-text hover:bg-editor-border active:scale-95 transition-colors"
                        title={t('editor.showTarget')}
                      >
                        {t('editor.showTarget')}
                      </button>
                    ) : showTarget ? (
                      <button
                        type="button"
                        onClick={toggleFocusMode}
                        className="px-1.5 py-0.5 rounded text-xs text-editor-muted hover:text-editor-text hover:bg-editor-border active:scale-95 transition-colors"
                        title={t('editor.hideSource')}
                      >
                        {t('editor.hideSource')}
                      </button>
                    ) : null}
                  </div>
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
                    onSelectionShortcut={handleSelectionShortcut}
                    onCommentClick={handleSourceCommentClick}
                  />
                  {/* 호버 오버레이 버튼 (위치 맞춤 / 복사) */}
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    {showTarget && (
                      <button
                        type="button"
                        onClick={handleAlignFromSource}
                        className="opacity-0 group-hover/source:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-[10px] bg-editor-surface/60 border border-editor-border/40 flex items-center gap-1 text-editor-muted hover:text-editor-text"
                        title={t('editor.alignScrollTitle', '상대 패널을 이 위치에 맞춤')}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                        {t('editor.alignScroll', '위치 맞춤')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleCopySource()}
                      className="opacity-0 group-hover/source:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-[10px] bg-editor-surface/60 border border-editor-border/40 flex items-center gap-1 text-editor-muted hover:text-editor-text"
                      title={t('common.copyToClipboard', '복사')}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      {t('common.copy', '복사')}
                    </button>
                  </div>
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
            {/* 밴드 2 (34px) — 섹션 캡션. 색상 대신 위계(캡션 타이포)로 구분한다 */}
            <div className={`${BAND_2} px-4 flex items-center justify-between border-b border-editor-hairline bg-editor-bg`}>
              <div className="flex items-center gap-3">
                <span className={CAPTION}>
                  {t('editor.target').toUpperCase()}
                </span>
                {focusMode ? (
                  <button
                    type="button"
                    onClick={toggleFocusMode}
                    className="px-1.5 py-0.5 rounded text-xs text-editor-muted hover:text-editor-text hover:bg-editor-border active:scale-95 transition-colors"
                    title={t('editor.showSource')}
                  >
                    {t('editor.showSource')}
                  </button>
                ) : showSource ? (
                  <button
                    type="button"
                    onClick={toggleSourceOnlyMode}
                    className="px-1.5 py-0.5 rounded text-xs text-editor-muted hover:text-editor-text hover:bg-editor-border active:scale-95 transition-colors"
                    title={t('editor.hideTarget')}
                  >
                    {t('editor.hideTarget')}
                  </button>
                ) : null}
                <Select
                  value={project.metadata.targetLanguage || AUTO_TARGET_LANGUAGE}
                  onChange={setTargetLanguage}
                  options={[
                    {
                      value: AUTO_TARGET_LANGUAGE,
                      // 자동이 지금 무엇으로 풀렸는지 라벨에 드러낸다 — 깜깜이 자동은 오설정만큼 위험하다
                      label: autoResolvedLanguage
                        ? t('editor.languages.autoResolved', {
                            language: localizeLanguage(t, autoResolvedLanguage),
                          })
                        : t('editor.languages.auto'),
                    },
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
            <div className={`min-h-0 flex-1 overflow-hidden transition-colors duration-500 relative group/target ${targetFlash ? 'bg-diff-insertion/10' : ''}`}>
              <TargetTipTapEditor
                content={targetDocument || ''}
                onChange={setTargetDocument}
                onJsonChange={setTargetDocJson}
                className="h-full"
                onEditorReady={handleTargetEditorReady}
                onSearchOpen={handleTargetSearchOpen}
                onSearchOpenWithReplace={handleTargetSearchOpenWithReplace}
                onSelectionShortcut={handleSelectionShortcut}
                onCommentClick={handleTargetCommentClick}
              />
              {/* 호버 오버레이 버튼 (위치 맞춤 / 복사) */}
              <div className="absolute top-2 right-2 flex items-center gap-1">
                {showSource && (
                  <button
                    type="button"
                    onClick={handleAlignFromTarget}
                    className="opacity-0 group-hover/target:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-[10px] bg-editor-surface/60 border border-editor-border/40 flex items-center gap-1 text-editor-muted hover:text-editor-text"
                    title={t('editor.alignScrollTitle', '상대 패널을 이 위치에 맞춤')}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                    {t('editor.alignScroll', '위치 맞춤')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleCopyTarget()}
                  className="opacity-0 group-hover/target:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-[10px] bg-editor-surface/60 border border-editor-border/40 flex items-center gap-1 text-editor-muted hover:text-editor-text"
                  title={t('common.copyToClipboard', '복사')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {t('common.copy', '복사')}
                </button>
              </div>
            </div>
          </div>
        </Panel>
        )}
      </PanelGroup>
      </div>

      {/* 정렬 검사 뷰 — 편집 중인 두 에디터 위에 얹는다 */}
      {isAlignmentMode && (
        <div className="absolute inset-0 overflow-hidden">
          <AlignmentView />
        </div>
      )}

      </div>

      {/* 폴리싱 지시사항 모달 */}
      {polishModalOpen && (
        <Modal
          open
          onClose={() => setPolishModalOpen(false)}
          labelId="polish-instruction-title"
          className="bg-black/50 p-4"
          closeOnOverlay={false}
        >
          <div className="bg-editor-surface border border-editor-border rounded-lg shadow-xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-editor-hairline">
              <h3 id="polish-instruction-title" className="text-sm font-semibold text-editor-text">
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
                  className="mt-1.5 w-full h-24 px-3 py-2 text-sm bg-editor-bg border border-editor-border rounded-md resize-none focus:outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2 text-editor-text placeholder:text-editor-muted"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      setPolishModalOpen(false);
                      void runPolishFromModal();
                    }
                  }}
                />
                <RecentInstructions
                  projectId={project?.id}
                  kind="documentPolish"
                  value={polishMessage}
                  onPick={setPolishMessage}
                />
              </div>
              {/* 범위 실행: 해제하면 문서 전체를 다듬는다 */}
              {polishScope && countScopedCells(polishScope) > 0 && (
                <label className="flex items-start gap-2 text-xs text-editor-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={polishScopeEnabled}
                    onChange={(e) => setPolishScopeEnabled(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span data-testid="polish-scope-label">
                    {t(
                      polishScope.kind === 'top-level-blocks'
                        ? 'editor.polishModal.scopeLabel'
                        : 'editor.polishModal.scopeLabelCells',
                      { count: countScopedCells(polishScope) },
                    )}
                  </span>
                </label>
              )}
            </div>
            <div className="px-4 py-3 border-t border-editor-hairline flex justify-end gap-2">
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
                  void runPolishFromModal();
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-primary-fill text-white hover:bg-primary-fill-hover transition-colors"
              >
                {t('editor.polishModal.execute', '폴리싱 실행')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 재번역 지시사항 모달 (타겟에 이미 내용이 있을 때 번역 버튼 클릭 시) */}
      {retranslateModalOpen && (
        <Modal
          open
          onClose={() => {
            setRetranslateModalOpen(false);
            setContinuationPlanResult(null);
          }}
          labelId="retranslate-instruction-title"
          className="bg-black/50 p-4"
          closeOnOverlay={false}
        >
          <div className="bg-editor-surface border border-editor-border rounded-lg shadow-xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-editor-hairline">
              <h3 id="retranslate-instruction-title" className="text-sm font-semibold text-editor-text">
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
                  className="mt-1.5 w-full h-24 px-3 py-2 text-sm bg-editor-bg border border-editor-border rounded-md resize-none focus:outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2 text-editor-text placeholder:text-editor-muted"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      setRetranslateModalOpen(false);
                      setContinuationPlanResult(null);
                      void openTranslatePreview(retranslateMessage);
                    }
                  }}
                />
                <RecentInstructions
                  projectId={project?.id}
                  kind="documentRetranslate"
                  value={retranslateMessage}
                  onPick={setRetranslateMessage}
                />
              </div>
              {continuationPlanResult?.ok && (
                <div className="space-y-1">
                  <p className="text-xs text-editor-muted">
                    {t('editor.continueTranslateHint')}
                  </p>
                  {continuationPlanResult.plan.middleGapUnitCount > 0 && (
                    <p className="text-xs text-editor-muted">
                      {t('editor.continueTranslateMiddleGap', {
                        count: continuationPlanResult.plan.middleGapUnitCount,
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-editor-hairline flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRetranslateModalOpen(false);
                  setContinuationPlanResult(null);
                }}
                className="px-3 py-1.5 text-xs rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
              >
                {t('common.cancel', '취소')}
              </button>
              {/* 이어서 번역: 남은 원문 suffix만 번역해 기존 번역 뒤에 이어 붙인다.
                  판정이 애매한 사유(misaligned-prefix)는 숨기지 않고 비활성 + 사유를 밝힌다. */}
              {continuationPlanResult?.ok === true && (
                <button
                  type="button"
                  onClick={() => {
                    const plan = continuationPlanResult.plan;
                    setRetranslateModalOpen(false);
                    setContinuationPlanResult(null);
                    void openTranslatePreview(retranslateMessage, { continuationPlan: plan });
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-primary-fill text-primary-fill hover:bg-editor-bg transition-colors"
                >
                  {t('editor.continueTranslateRemaining', {
                    count: continuationPlanResult.plan.remainingUnitCount,
                  })}
                </button>
              )}
              {continuationPlanResult?.ok === false
                && continuationPlanResult.reason === 'misaligned-prefix' && (
                <button
                  type="button"
                  disabled
                  title={t('editor.continueTranslateUnavailable.misalignedPrefix')}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-editor-border text-editor-muted cursor-not-allowed"
                >
                  {t('editor.continueTranslate')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRetranslateModalOpen(false);
                  setContinuationPlanResult(null);
                  void openTranslatePreview(retranslateMessage);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-primary-fill text-white hover:bg-primary-fill-hover transition-colors"
              >
                {t('review.retranslate.modal.execute', '재번역 실행')}
              </button>
            </div>
          </div>
        </Modal>
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
        originalDocJson={translateOriginalDocJson}
        onApplySelective={applyTranslateDoc}
        onClose={() => {
          setTranslatePreviewOpen(false);
          setTranslateOriginalDocJson(null);
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

      {/* 인라인 선택 툴바 (선택만 해도 표시) — 코멘트 popover가 열리면 양보한다 */}
      {selectionToolbar && !commentPopover && !commentDetailPopover && (
        <SelectionInlineToolbar
          panel={selectionToolbar.field}
          containerRef={selectionToolbarRef}
          style={{
            position: 'fixed',
            top: selectionToolbar.top,
            left: selectionToolbar.left,
            zIndex: 80,
            zoom: 1 / useUIStore.getState().editorZoom,
          }}
          onCopy={() => {
            void handleCopySelection(selectionToolbar);
            setSelectionToolbar(null);
          }}
          onAddToChat={() => {
            const selection = createChatSelection(selectionToolbar);
            if (!selection) return;
            openChatWithSelection(selection);
            setSelectionToolbar(null);
          }}
          {...(selectionToolbar.field === 'target'
            ? {
                onRetranslateSelection: () => {
                  void openSelectionEdit(selectionToolbar, 'retranslate');
                  setSelectionToolbar(null);
                },
                onPolishSelection: () => {
                  void openSelectionEdit(selectionToolbar, 'polish');
                  setSelectionToolbar(null);
                },
                onReviewSelection: () => {
                  openScopedReview(selectionToolbar);
                  setSelectionToolbar(null);
                },
              }
            : {})}
          onAddComment={() => {
            const b = selectionToolbar;
            setCommentPopover({
              top: b.top + SELECTION_INLINE_TOOLBAR_HEIGHT + 4,
              left: b.left,
              excerpt: b.text.trim(),
              editor: b.editor,
              field: b.field,
              ranges: b.ranges,
              segmentGroupId: b.segmentGroupId,
            });
            setSelectionToolbar(null);
          }}
        />
      )}

      <SelectionEditPreviewModal
        open={selectionEdit !== null}
        selection={selectionEdit?.selection ?? null}
        mode={selectionEdit?.mode ?? 'retranslate'}
        sourceText={selectionEdit?.sourceText ?? ''}
        sourceAlignmentPrecision={selectionEdit?.sourceAlignmentPrecision}
        replacementText={selectionEdit?.replacementText ?? ''}
        cells={selectionEdit?.cells}
        instruction={selectionEdit?.instruction ?? ''}
        referenceOptions={
          selectionEdit?.referenceOptions ?? DEFAULT_SELECTION_REFERENCE_OPTIONS
        }
        contextManifest={selectionEdit?.contextManifest}
        isLoading={selectionEdit?.loading ?? false}
        error={selectionEdit?.error}
        onInstructionChange={(instruction) => {
          selectionInstructionRef.current = instruction;
          // 결과(replacementText)는 지우지 않는다 — 수동 편집을 지시문 타이핑이
          // 날려버리지 않도록. 재생성은 "다시 재번역" 버튼이 명시적으로 한다.
          setSelectionEdit((current) => current ? {
            ...current,
            instruction,
            error: null,
          } : null);
        }}
        onReplacementChange={(replacementText) =>
          setSelectionEdit((current) => current ? {
            ...current,
            replacementText,
          } : null)
        }
        onReferenceOptionsChange={(referenceOptions) => {
          selectionReferenceOptionsRef.current = referenceOptions;
          // 지시사항 입력과 같은 규칙 — 참조 범위를 바꿔도 이미 받은 결과와 손편집은
          // 지우지 않는다. 재생성은 "다시 실행" 버튼이 명시적으로 한다. 남아 있는
          // contextManifest는 지금 보이는 결과가 무엇을 참조했는지를 계속 가리킨다.
          setSelectionEdit((current) => current ? {
            ...current,
            referenceOptions,
            error: null,
          } : null);
        }}
        onGenerate={() => void generateSelectionEdit()}
        onApply={applyCurrentSelectionEdit}
        onClose={closeSelectionEdit}
      />

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
                ranges: commentPopover.ranges,
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
