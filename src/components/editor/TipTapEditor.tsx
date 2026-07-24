import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ImageOriginal, ImagePlaceholder } from '@/editor/extensions/ImagePlaceholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import { useReviewStore } from '@/stores/reviewStore';
import { registerEditorSyncFlush, getDocSyncEpoch } from '@/stores/projectStore';
import { ReviewHighlight, refreshEditorHighlight } from '@/editor/extensions/ReviewHighlight';
import { SearchHighlight } from '@/editor/extensions/SearchHighlight';
import { CommentMark } from '@/editor/extensions/CommentMark';
import { SelectionAnchor } from '@/editor/extensions/SelectionAnchor';
import { TranslationUnitId } from '@/editor/extensions/TranslationUnitId';
import { getCommentIdFromDomTarget } from '@/editor/utils/commentNavigation';
import { normalizePastedHtml } from '@/utils/htmlNormalizer';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';

/**
 * onChange/onJsonChange 디바운스 간격 (P1).
 * onUpdate마다 getHTML()+getJSON()(둘 다 O(문서))을 실행하면 대형 문서에서 키 입력당
 * 수십 ms 랙이 생기므로, store 동기화를 디바운스한다. 저장 자체가 write-through 500ms
 * 디바운스라 정합성 손실은 없다. 유실 방지 flush 경로:
 * - projectStore.saveProject / materializeBlocksForSnapshot / switchProjectById가
 *   registerEditorSyncFlush로 등록된 flush를 먼저 실행
 * - blur / 에디터 destroy 시점에 자체 flush
 */
const SYNC_DEBOUNCE_MS = 250;

export interface TipTapEditorProps {
  panelType: 'source' | 'target';
  content: string;
  onChange?: (content: string) => void;
  onJsonChange?: (json: Record<string, unknown>) => void;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
  onSearchOpen?: () => void;
  onSearchOpenWithReplace?: () => void;
  onSelectionShortcut?: (editor: Editor, panel: 'source' | 'target') => void;
  onCommentClick?: (payload: { commentId: string; top: number; left: number }) => void;
}

function TipTapEditor({
  panelType,
  content,
  onChange,
  onJsonChange,
  className = '',
  onEditorReady,
  onSearchOpen,
  onSearchOpenWithReplace,
  onSelectionShortcut,
  onCommentClick,
}: TipTapEditorProps): JSX.Element {
  const { t } = useTranslation();
  const highlightNonce = useReviewStore((s) => s.highlightNonce);
  const pasteImageMode = useUIStore((s) => s.pasteImageMode);
  const pasteLinkPreserve = useUIStore((s) => s.pasteLinkPreserve);

  // pasteImageMode에 따라 Image extension 선택
  // original: 기본 Image (실제 <img> 렌더링), placeholder/ignore: ImagePlaceholder
  const imageExtension = useMemo(() => {
    if (pasteImageMode === 'original') {
      return ImageOriginal.configure({ inline: true, allowBase64: true });
    }
    return ImagePlaceholder.configure({ inline: true, allowBase64: true });
  }, [pasteImageMode]);

  // pasteLinkPreserve에 따라 Link extension 포함/제외
  // false면 에디터에 링크 mark 자체가 존재하지 않음
  const extensions = useMemo(() => {
    const base = [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        history: { depth: 100, newGroupDelay: 500 },
      }),
      Placeholder.configure({
        placeholder: t(panelType === 'source' ? 'editor.sourcePlaceholder' : 'editor.targetPlaceholder'),
        emptyEditorClass: 'tiptap-empty',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      imageExtension,
      Underline,
      Highlight.configure({ multicolor: false }),
      Subscript,
      Superscript,
      CommentMark,
      TranslationUnitId,
      SelectionAnchor,
      ReviewHighlight.configure({
        highlightClass: 'review-highlight',
        excerptField: panelType === 'source' ? 'sourceExcerpt' : 'targetExcerpt',
      }),
      SearchHighlight.configure({
        searchClass: 'search-match',
        currentClass: 'search-current',
      }),
    ];
    if (pasteLinkPreserve) {
      base.splice(1, 0, Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: { class: 'tiptap-link' },
      }));
    }
    return base;
  }, [imageExtension, pasteLinkPreserve, t, panelType]);

  const lastContentRef = useRef<string>(content);
  const onSearchOpenRef = useRef(onSearchOpen);
  const onSearchOpenWithReplaceRef = useRef(onSearchOpenWithReplace);
  const onSelectionShortcutRef = useRef(onSelectionShortcut);
  const onCommentClickRef = useRef(onCommentClick);
  onSearchOpenRef.current = onSearchOpen;
  onSearchOpenWithReplaceRef.current = onSearchOpenWithReplace;
  onSelectionShortcutRef.current = onSelectionShortcut;
  onCommentClickRef.current = onCommentClick;

  // ─── 디바운스된 store 동기화 (P1) ─────────────────────────────────────────
  const onChangeRef = useRef(onChange);
  const onJsonChangeRef = useRef(onJsonChange);
  onChangeRef.current = onChange;
  onJsonChangeRef.current = onJsonChange;

  const editorInstanceRef = useRef<Editor | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  // 스케줄 시점의 문서 동기화 세대. 프로젝트가 교체되면(loadProject) 세대가 증가하므로,
  // 이전 프로젝트에서 스케줄된 flush가 늦게 발화해 새 프로젝트 store를 덮는 것을 막는다.
  const scheduledEpochRef = useRef<number>(0);

  const emitPendingSync = useCallback((): void => {
    const ed = editorInstanceRef.current;
    if (!ed || ed.isDestroyed) return;
    if (scheduledEpochRef.current !== getDocSyncEpoch()) return;
    const html = ed.getHTML();
    if (html === lastContentRef.current) return;
    lastContentRef.current = html;
    onChangeRef.current?.(html);
    onJsonChangeRef.current?.(ed.getJSON() as Record<string, unknown>);
  }, []);

  /** pending 디바운스가 있으면 즉시 반영. 없으면 no-op(불필요한 직렬화 방지). */
  const flushPendingSync = useCallback((): void => {
    if (syncTimerRef.current === null) return;
    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = null;
    emitPendingSync();
  }, [emitPendingSync]);

  const cancelPendingSync = useCallback((): void => {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  const scheduleSync = useCallback((ed: Editor): void => {
    editorInstanceRef.current = ed;
    scheduledEpochRef.current = getDocSyncEpoch();
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      emitPendingSync();
    }, SYNC_DEBOUNCE_MS);
  }, [emitPendingSync]);

  const editor = useEditor({
    extensions,
    content,
    editable: true,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const handler = onCommentClickRef.current;
          if (!handler) return false;
          const commentId = getCommentIdFromDomTarget(event.target);
          if (!commentId) return false;

          const el = (event.target as Element).closest('[data-comment-id]');
          if (!el) return false;

          const rect = el.getBoundingClientRect();
          handler({
            commentId,
            top: Math.min(window.innerHeight - 120, rect.bottom + 6),
            left: Math.min(window.innerWidth - 320, Math.max(8, rect.left)),
          });
          return true;
        },
      },
      transformPastedHTML: (html) => {
        // 항상 최신 설정값을 읽어서 stale closure 문제 방지
        const { pasteImageMode: imgMode } = useUIStore.getState();
        const removeImages = imgMode === 'ignore';
        if (removeImages) {
          return normalizePastedHtml(html, { removeImages });
        }
        return normalizePastedHtml(html);
      },
      handleKeyDown: (_view, event) => {
        // Cmd+F: 검색 열기
        const isSearchShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f';
        if (isSearchShortcut) {
          event.preventDefault();
          onSearchOpenRef.current?.();
          return true;
        }

        // Cmd+H: 검색+치환 열기 (target 패널 전용)
        if (panelType === 'target') {
          const isReplaceShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'h';
          if (isReplaceShortcut) {
            event.preventDefault();
            onSearchOpenWithReplaceRef.current?.();
            return true;
          }
        }

        const isSelectionShortcut = (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === 'l' || event.key.toLowerCase() === 'k');

        const currentEditor = editorInstanceRef.current;
        if (isSelectionShortcut && currentEditor) {
          const { from, to } = currentEditor.state.selection;
          if (from === to) return false;

          event.preventDefault();
          onSelectionShortcutRef.current?.(currentEditor, panelType);
          return true;
        }

        return false;
      },
    },
    onCreate: ({ editor: ed }) => {
      editorInstanceRef.current = ed;
      lastContentRef.current = ed.getHTML();
      // 초기 JSON 캐시는 즉시 push (에디터 마운트 전 AI 도구 접근 대비)
      onJsonChangeRef.current?.(ed.getJSON() as Record<string, unknown>);
    },
    onUpdate: ({ editor: ed }) => {
      // 키 입력마다 직렬화하지 않고 디바운스로 묶는다 (P1).
      scheduleSync(ed);
    },
    onBlur: () => {
      // 포커스 이탈은 편집 단위 종료 신호 — pending 변경을 즉시 반영
      flushPendingSync();
    },
    onDestroy: () => {
      // destroy 이벤트는 view 해체 전에 발생하므로 마지막 pending 변경을 회수할 수 있다
      flushPendingSync();
    },
  }, [extensions]);

  // 외부 content 변경 시 에디터 업데이트 (lastContentRef로 비교하여 false positive 방지)
  useEffect(() => {
    if (!editor) return;
    if (content === lastContentRef.current) return;
    // 외부 교체(프로젝트 전환/스냅샷 복원 등)는 pending 편집보다 우선한다.
    // pending flush를 폐기하지 않으면 교체 직후 stale 편집이 store를 되돌릴 수 있다.
    cancelPendingSync();
    replaceDocContent(editor, content, { addToHistory: false });
    // 교체된 prop 값을 동기화 기준으로 삼는다. (replaceDocContent의 onUpdate가 스케줄한
    // 디바운스는 이후 정규화 차이가 있을 때만 echo를 store로 내보낸다)
    lastContentRef.current = content;
  }, [editor, content, cancelPendingSync]);

  // 저장/스냅샷/프로젝트 전환 시 projectStore가 pending 동기화를 강제 flush할 수 있도록 등록
  useEffect(() => {
    if (!editor) return;
    editorInstanceRef.current = editor;
    return registerEditorSyncFlush(flushPendingSync);
  }, [editor, flushPendingSync]);

  // 에디터 준비 완료 콜백
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // highlightNonce 변경 시 decoration 새로고침
  useEffect(() => {
    if (editor && highlightNonce > 0) {
      refreshEditorHighlight(editor);
    }
  }, [editor, highlightNonce]);

  if (!editor) {
    return <div className="h-full animate-pulse bg-editor-surface rounded-md" />;
  }

  return (
    <div className={`tiptap-wrapper ${panelType}-editor ${className}`} data-testid={`${panelType}-editor`}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}

// 하위 호환 래퍼
type PanellessProps = Omit<TipTapEditorProps, 'panelType'>;

export function SourceTipTapEditor(props: PanellessProps): JSX.Element {
  return TipTapEditor({ ...props, panelType: 'source' });
}

export function TargetTipTapEditor(props: PanellessProps): JSX.Element {
  return TipTapEditor({ ...props, panelType: 'target' });
}
