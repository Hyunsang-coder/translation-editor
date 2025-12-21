import { useProjectStore } from '@/stores/projectStore';
import { TargetMonacoEditor } from '@/components/editor/TargetMonacoEditor';
import { useMemo, useRef } from 'react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import { buildTargetDocument } from '@/editor/targetDocument';
import { DomSelectionAddToChat } from '@/components/editor/DomSelectionAddToChat';
import { SourceMonacoEditor } from '@/components/editor/SourceMonacoEditor';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { useChatStore } from '@/stores/chatStore';

interface EditorCanvasProps {
  focusMode: boolean;
}

/**
 * 에디터 캔버스
 * SegmentGroup 단위로 2컬럼(원문/번역)을 한 컨테이너에서 렌더링하여 Para-Sync 정렬을 보장합니다.
 */
export function EditorCanvas({ focusMode }: EditorCanvasProps): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const targetDocument = useProjectStore((s) => s.targetDocument);
  const sourceDocument = useProjectStore((s) => s.sourceDocument);
  const setTargetDocument = useProjectStore((s) => s.setTargetDocument);
  const setSourceDocument = useProjectStore((s) => s.setSourceDocument);
  const rebuildTargetDocument = useProjectStore((s) => s.rebuildTargetDocument);
  const rebuildSourceDocument = useProjectStore((s) => s.rebuildSourceDocument);
  const includeSourceInPayload = useChatStore((s) => s.includeSourceInPayload);
  const includeTargetInPayload = useChatStore((s) => s.includeTargetInPayload);
  const setIncludeSourceInPayload = useChatStore((s) => s.setIncludeSourceInPayload);
  const setIncludeTargetInPayload = useChatStore((s) => s.setIncludeTargetInPayload);

  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);

  // Hook 순서 보장을 위해, project가 null이어도 useMemo/useCallback은 항상 호출합니다.
  const derived = useMemo(() => {
    if (!project) {
      return {
        blockRanges: {} as Record<string, { startOffset: number; endOffset: number }>,
        sourceDocument: '',
      };
    }
    const built = buildTargetDocument(project);
    return {
      blockRanges: built.blockRanges,
      sourceDocument: buildSourceDocument(project).text,
    };
  }, [project]);

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-editor-muted">
        프로젝트를 불러오는 중...
      </div>
    );
  }

  return (
    <div className="h-full p-editor-padding flex flex-col min-h-0">
      <DomSelectionAddToChat />
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-editor-muted uppercase tracking-wider">
            Editor
          </h2>
          <span className="text-xs text-editor-muted">
            {project.metadata.sourceLanguage} → {project.metadata.targetLanguage}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-editor-muted">
          <label className="inline-flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-primary-500"
              checked={includeSourceInPayload}
              onChange={(e) => setIncludeSourceInPayload(e.target.checked)}
            />
            원문을 AI 컨텍스트에 포함
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-primary-500"
              checked={includeTargetInPayload}
              onChange={(e) => setIncludeTargetInPayload(e.target.checked)}
            />
            번역문을 AI 컨텍스트에 포함
          </label>
        </div>
      </div>

      {/* Cursor 느낌: 좌(Source) / 우(Target) 두 에디터 */}
      <div className={`flex-1 min-h-0 grid gap-3 ${focusMode ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {!focusMode && (
          <div className="min-h-0 flex flex-col">
            <div className="text-xs text-editor-muted mb-2">SOURCE (reference)</div>
            <div className="min-h-0 flex-1" data-ite-source>
              <SourceMonacoEditor
                value={sourceDocument || derived.sourceDocument}
                onChange={(next) => setSourceDocument(next)}
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex flex-col">
          <div className="text-xs text-editor-muted mb-2">TARGET</div>
          <div className="min-h-0 flex-1">
            <TargetMonacoEditor
              value={targetDocument}
              onChange={setTargetDocument}
              blockRanges={derived.blockRanges}
              onMount={(ed) => {
                editorRef.current = ed;
                if (!targetDocument) {
                  rebuildTargetDocument();
                }
                if (!sourceDocument) {
                  rebuildSourceDocument();
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


