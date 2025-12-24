import { useMemo, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { findGhostChips } from '@/utils/ghostChip';

export interface TargetMonacoEditorProps {
  value: string;
  onChange: (next: string) => void;
  blockRanges?: Record<string, { startOffset: number; endOffset: number }>;
  onMount?: (editor: MonacoEditorNS.IStandaloneCodeEditor) => void;
}

/**
 * Target 단일 문서 에디터 (Monaco)
 * - TRD "Document Mode" 옵션을 최대한 반영
 */
export function TargetMonacoEditor({
  value,
  onChange,
  blockRanges,
  onMount,
}: TargetMonacoEditorProps): JSX.Element {
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const trackedRangeDecorationIds = useRef<string[]>([]);
  const idByBlockIdRef = useRef<Record<string, string>>({});
  const modelChangeDisposable = useRef<{ dispose: () => void } | null>(null);
  const theme = useUIStore((s) => s.theme);
  const setSelectedBlockId = useUIStore((s) => s.setSelectedBlockId);
  const registerTargetDocHandle = useProjectStore((s) => s.registerTargetDocHandle);
  const pendingDocDiff = useProjectStore((s) => s.pendingDocDiff);
  const setPendingDocDiffTrackedDecorationId = useProjectStore(
    (s) => s.setPendingDocDiffTrackedDecorationId,
  );

  const pendingDecorationIds = useRef<string[]>([]);
  const pendingAnchorDecorationId = useRef<string | null>(null);
  const pendingContentWidgetRef = useRef<MonacoEditorNS.IContentWidget | null>(null);

  const updateTrackedRanges = (): void => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model || !blockRanges) {
      trackedRangeDecorationIds.current = [];
      idByBlockIdRef.current = {};
      return;
    }

    // 기존 tracked range decorations 정리
    if (trackedRangeDecorationIds.current.length > 0) {
      trackedRangeDecorationIds.current = model.deltaDecorations(
        trackedRangeDecorationIds.current,
        [],
      );
    }

    const blockIds = Object.keys(blockRanges);
    const decorations = blockIds.map((blockId) => {
      const r = blockRanges[blockId]!;
      const start = model.getPositionAt(r.startOffset);
      const end = model.getPositionAt(r.endOffset);
      return {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
        },
      } satisfies MonacoEditorNS.IModelDeltaDecoration;
    });

    const decorationIds = model.deltaDecorations([], decorations);
    trackedRangeDecorationIds.current = decorationIds;

    const nextMap: Record<string, string> = {};
    decorationIds.forEach((id, idx) => {
      const bid = blockIds[idx];
      if (bid) nextMap[bid] = id;
    });
    idByBlockIdRef.current = nextMap;
  };

  // 프로젝트 전환 등으로 blockRanges가 바뀌면 tracked ranges를 다시 세팅해야 저장이 정상 동작합니다.
  useEffect(() => {
    updateTrackedRanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockRanges]);

  useEffect(() => {
    return () => {
      try {
        modelChangeDisposable.current?.dispose();
      } catch {
        // ignore
      }
    };
  }, []);

  // In-place preview for pending doc diff
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;

    // cleanup previous widget
    if (pendingContentWidgetRef.current) {
      try {
        ed.removeContentWidget(pendingContentWidgetRef.current);
      } catch {
        // ignore
      }
      pendingContentWidgetRef.current = null;
    }

    // clear previous decorations
    if (pendingDecorationIds.current.length > 0) {
      model.deltaDecorations(pendingDecorationIds.current, []);
      pendingDecorationIds.current = [];
    }
    if (pendingAnchorDecorationId.current) {
      model.deltaDecorations([pendingAnchorDecorationId.current], []);
      pendingAnchorDecorationId.current = null;
    }

    if (!pendingDocDiff) return;

    const { startOffset, endOffset, suggestedText, sessionId } = pendingDocDiff;
    const startPos = model.getPositionAt(startOffset);
    const endPos = model.getPositionAt(endOffset);

    // tracked anchor decoration (range tracking)
    const anchorIds = model.deltaDecorations([], [
      {
        range: new monaco.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column,
        ),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      } satisfies MonacoEditorNS.IModelDeltaDecoration,
    ]);
    const anchorId = anchorIds[0] ?? null;
    pendingAnchorDecorationId.current = anchorId;
    if (anchorId && sessionId) {
      setPendingDocDiffTrackedDecorationId({ sessionId, decorationId: anchorId });
    }

    // preview decoration: mark the "to be replaced" range (deletion-like)
    const decorations: MonacoEditorNS.IModelDeltaDecoration[] = [
      {
        range: new monaco.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column,
        ),
        options: {
          inlineClassName: 'monaco-pending-delete',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      },
    ];

    pendingDecorationIds.current = model.deltaDecorations([], decorations);

    // content widget: show suggested replacement in-place (without mutating the document)
    if (anchorId) {
      const widgetId = `ite.pending-doc-diff.${sessionId ?? anchorId}`;
      const dom = document.createElement('div');
      dom.className = 'monaco-pending-insert-widget';
      dom.setAttribute('data-ite-pending-session', sessionId ?? '');

      const header = document.createElement('div');
      header.className = 'monaco-pending-insert-widget__header';
      header.textContent = 'Pending Edit';

      const body = document.createElement('pre');
      body.className = 'monaco-pending-insert-widget__body';
      body.textContent = suggestedText ?? '';

      // Keep/Discard 버튼 추가
      const footer = document.createElement('div');
      footer.className = 'monaco-pending-insert-widget__footer';

      const keepBtn = document.createElement('button');
      keepBtn.className = 'monaco-pending-insert-widget__btn monaco-pending-insert-widget__btn--keep';
      keepBtn.textContent = 'Keep (⌘Y)';
      keepBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        useProjectStore.getState().acceptDocDiff();
      });

      const discardBtn = document.createElement('button');
      discardBtn.className = 'monaco-pending-insert-widget__btn monaco-pending-insert-widget__btn--discard';
      discardBtn.textContent = 'Discard (⌘N)';
      discardBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        useProjectStore.getState().rejectDocDiff();
      });

      footer.appendChild(keepBtn);
      footer.appendChild(discardBtn);

      dom.appendChild(header);
      dom.appendChild(body);
      dom.appendChild(footer);

      const widget: MonacoEditorNS.IContentWidget = {
        getId: () => widgetId,
        getDomNode: () => dom,
        getPosition: () => {
          const r = model.getDecorationRange(anchorId);
          if (!r) return null;
          return {
            position: r.getEndPosition(),
            preference: [
              monaco.editor.ContentWidgetPositionPreference.BELOW,
              monaco.editor.ContentWidgetPositionPreference.ABOVE,
            ],
          };
        },
      };

      pendingContentWidgetRef.current = widget;
      ed.addContentWidget(widget);
      ed.layoutContentWidget(widget);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDocDiff?.sessionId, pendingDocDiff?.startOffset, pendingDocDiff?.endOffset, pendingDocDiff?.suggestedText]);

  const monacoTheme = useMemo(() => {
    if (theme === 'dark') return 'vs-dark';
    if (theme === 'light') return 'light';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'vs-dark' : 'light';
  }, [theme]);

  const options: MonacoEditorNS.IStandaloneEditorConstructionOptions = useMemo(
    () => ({
      // Document Mode options (TRD)
      fontFamily:
        "'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      fontSize: 16,
      lineHeight: 28, // 16px * 1.75 ~= 28 (TRD 1.8에 근접)
      lineNumbers: 'off',
      minimap: { enabled: false },
      glyphMargin: false,
      wordWrap: 'on',
      renderLineHighlight: 'none',

      // UX defaults
      automaticLayout: true,
      scrollBeyondLastLine: false,
      overviewRulerLanes: 0,
      folding: false,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      renderWhitespace: 'none',
      guides: {
        indentation: false,
      },
      contextmenu: false,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      parameterHints: { enabled: false },
      // monaco-editor 타입은 enum(ShowLightbulbIconMode)을 요구합니다.
      // 런타임 monaco를 직접 import하지 않기 위해 literal을 타입 캐스팅합니다.
      lightbulb: { enabled: 'off' as unknown as MonacoEditorNS.ShowLightbulbIconMode },
    }),
    [],
  );

  return (
    <div className="relative h-full w-full rounded-md border border-editor-border bg-editor-bg overflow-hidden">
      <Editor
        height="100%"
        language="plaintext"
        theme={monacoTheme}
        value={value}
        options={options}
        onChange={(next) => onChange(next ?? '')}
        onMount={(ed, monaco) => {
          editorRef.current = ed;
          monacoRef.current = monaco;
          onMount?.(ed);

          // 최초 설정
          updateTrackedRanges();

          // Register Handle (Once per editor instance)
          const model = ed.getModel();
          // Anchor decoration ID 관리용 ref (apply 요청 시 생성된 decoration)
          const anchorDecorationIdsRef = { current: [] as string[] };

          if (model) {
            registerTargetDocHandle({
              getBlockOffsets: () => {
                const out: Record<string, { startOffset: number; endOffset: number }> = {};
                Object.entries(idByBlockIdRef.current).forEach(([bid, decId]) => {
                  const range = model.getDecorationRange(decId);
                  if (!range) return;
                  const startOffset = model.getOffsetAt(range.getStartPosition());
                  const endOffset = model.getOffsetAt(range.getEndPosition());
                  out[bid] = { startOffset, endOffset };
                });
                return out;
              },
              getDecorationOffsets: (decorationId) => {
                const r = model.getDecorationRange(decorationId);
                if (!r) return null;
                const startOffset = model.getOffsetAt(r.getStartPosition());
                const endOffset = model.getOffsetAt(r.getEndPosition());
                return { startOffset, endOffset };
              },
              getSelection: () => {
                const sel = ed.getSelection();
                if (sel) {
                  const startOffset = model.getOffsetAt(sel.getStartPosition());
                  const endOffset = model.getOffsetAt(sel.getEndPosition());
                  const text = model.getValueInRange(sel);
                  return { startOffset, endOffset, text };
                }
                return null;
              },
              // Apply Anchor: 요청 시점에 tracked decoration 생성
              createAnchorDecoration: (startOffset, endOffset) => {
                const startPos = model.getPositionAt(startOffset);
                const endPos = model.getPositionAt(endOffset);
                const ids = model.deltaDecorations([], [
                  {
                    range: new monaco.Range(
                      startPos.lineNumber,
                      startPos.column,
                      endPos.lineNumber,
                      endPos.column,
                    ),
                    options: {
                      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                      // 시각적으로는 표시하지 않음 (invisible anchor)
                    },
                  },
                ]);
                const decorationId = ids[0] ?? null;
                if (decorationId) {
                  anchorDecorationIdsRef.current.push(decorationId);
                }
                return decorationId;
              },
              // Apply Anchor: decoration 제거
              removeDecoration: (decorationId) => {
                model.deltaDecorations([decorationId], []);
                anchorDecorationIdsRef.current = anchorDecorationIdsRef.current.filter(
                  (id) => id !== decorationId,
                );
              },
            });
          }

          // 모델이 교체되는 케이스를 대비(프로젝트 전환/리로드 등)
          try {
            modelChangeDisposable.current?.dispose();
          } catch {
            // ignore
          }
          modelChangeDisposable.current = ed.onDidChangeModel(() => {
            updateTrackedRanges();
          });

          // Ghost chips (태그 보호) - decoration + 편집 차단
          const uiAddToast = useUIStore.getState().addToast;
          let ghostDecorationIds: string[] = [];
          let suppressNextChange = false;

          const updateGhostDecorations = (): void => {
            const model = ed.getModel();
            if (!model) return;
            const text = model.getValue();
            const matches = findGhostChips(text);

            const decorations = matches.map((m) => {
              const start = model.getPositionAt(m.start);
              const end = model.getPositionAt(m.end);
              return {
                range: new monaco.Range(
                  start.lineNumber,
                  start.column,
                  end.lineNumber,
                  end.column,
                ),
                options: {
                  inlineClassName: 'monaco-ghost-chip',
                  stickiness:
                    monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
                },
              } satisfies MonacoEditorNS.IModelDeltaDecoration;
            });

            ghostDecorationIds = model.deltaDecorations(ghostDecorationIds, decorations);
          };

          const rangeOverlapsGhost = (changeStart: number, changeEnd: number): boolean => {
            const model = ed.getModel();
            if (!model) return false;
            for (const id of ghostDecorationIds) {
              const r = model.getDecorationRange(id);
              if (!r) continue;
              const s = model.getOffsetAt(r.getStartPosition());
              const e = model.getOffsetAt(r.getEndPosition());
              // overlap if intervals intersect
              if (changeStart < e && changeEnd > s) return true;
            }
            return false;
          };

          updateGhostDecorations();
          ed.onDidChangeModelContent((e) => {
            if (suppressNextChange) {
              suppressNextChange = false;
              updateGhostDecorations();
              return;
            }

            const model = ed.getModel();
            if (!model) return;

            for (const c of e.changes) {
              const startPos = new monaco.Position(
                c.range.startLineNumber,
                c.range.startColumn,
              );
              const endPos = new monaco.Position(
                c.range.endLineNumber,
                c.range.endColumn,
              );
              const start = model.getOffsetAt(startPos);
              const end = model.getOffsetAt(endPos);
              const changeStart = Math.min(start, end);
              const changeEnd = Math.max(start, end);
              if (rangeOverlapsGhost(changeStart, changeEnd)) {
                suppressNextChange = true;
                ed.trigger('ite', 'undo', null);
                uiAddToast({
                  type: 'warning',
                  message: 'Ghost Chip(태그/변수)은 편집할 수 없습니다.',
                  duration: 2000,
                });
                return;
              }
            }

            updateGhostDecorations();
          });

          // Cmd+L or Cmd+K: Selection → Add to chat (모델 호출 없음)
          const addSelectionToChat = () => {
            const sel = ed.getSelection();
            const model = ed.getModel();
            if (!sel || !model || sel.isEmpty()) return;

            const selectedText = model.getValueInRange(sel).trim();
            if (!selectedText) return;

            const { sidebarCollapsed, toggleSidebar, setActivePanel } = useUIStore.getState();
            const { appendComposerText, requestComposerFocus } = useChatStore.getState();

            if (sidebarCollapsed) toggleSidebar();
            setActivePanel('chat');
            appendComposerText(selectedText);
            requestComposerFocus();
          };

          ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, addSelectionToChat);
          ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, addSelectionToChat);

          // Cmd+Y: Keep (Accept) pending diff
          ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
            const hasPending = useProjectStore.getState().pendingDocDiff !== null;
            if (hasPending) {
              useProjectStore.getState().acceptDocDiff();
            }
          });

          // Cmd+N: Discard (Reject) pending diff
          ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => {
            const hasPending = useProjectStore.getState().pendingDocDiff !== null;
            if (hasPending) {
              useProjectStore.getState().rejectDocDiff();
            }
          });

          // Monaco selection 기반 Add to chat (Cursor 스타일)
          ed.onDidChangeCursorSelection(() => {
            const sel = ed.getSelection();
            const model = ed.getModel();
            const domNode = ed.getDomNode();
            if (!sel || !model || !domNode) return;
            if (sel.isEmpty()) {
              const bubble = document.getElementById('ite-add-to-chat-monaco');
              if (bubble) bubble.style.display = 'none';
              return;
            }

            const selectedText = model.getValueInRange(sel).trim();
            const bubble = document.getElementById('ite-add-to-chat-monaco');
            if (!bubble) return;

            if (!selectedText) {
              bubble.style.display = 'none';
              return;
            }

            const end = sel.getEndPosition();
            const visible = ed.getScrolledVisiblePosition(end);
            if (!visible) {
              bubble.style.display = 'none';
              return;
            }

            const rect = domNode.getBoundingClientRect();
            const top = Math.max(8, rect.top + visible.top - 36);
            const left = Math.min(window.innerWidth - 140, Math.max(8, rect.left + visible.left));

            bubble.style.display = 'block';
            bubble.style.top = `${top}px`;
            bubble.style.left = `${left}px`;
            bubble.setAttribute('data-text', selectedText);
          });
        }}
      />

      {/* Monaco용 플로팅 버튼(React 바깥에서 위치를 직접 갱신) */}
      <button
        id="ite-add-to-chat-monaco"
        type="button"
        style={{
          position: 'fixed',
          display: 'none',
          top: 0,
          left: 0,
          zIndex: 50,
        }}
        className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-surface border border-editor-border hover:bg-editor-bg transition-colors shadow-sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const el = e.currentTarget;
          const text = (el.getAttribute('data-text') ?? '').trim();
          if (!text) return;

          const { sidebarCollapsed, toggleSidebar, setActivePanel } = useUIStore.getState();
          const { appendComposerText, requestComposerFocus } = useChatStore.getState();

          if (sidebarCollapsed) toggleSidebar();
          setActivePanel('chat');
          appendComposerText(text);
          requestComposerFocus();

          el.style.display = 'none';
        }}
        title="선택한 텍스트를 채팅 입력창에 추가"
      >
        Add to chat
      </button>

    </div>
  );
}
