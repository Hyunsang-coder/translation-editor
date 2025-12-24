import { useProjectStore } from '@/stores/projectStore';
import { TargetMonacoEditor } from '@/components/editor/TargetMonacoEditor';
import { useMemo, useRef } from 'react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import { buildTargetDocument } from '@/editor/targetDocument';
import { SourceMonacoEditor } from '@/components/editor/SourceMonacoEditor';
import { buildSourceDocument } from '@/editor/sourceDocument';

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
    <div className="flex-1 h-full flex flex-col min-w-0 bg-editor-surface">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-editor-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-editor-text tracking-wide">EDITOR</span>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {!focusMode && (
          <div className="flex-1 flex flex-col min-w-0 border-r border-editor-border">
            <div className="h-8 px-4 flex items-center justify-between bg-editor-bg border-b border-editor-border">
              <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
                SOURCE
              </span>
            </div>
            <div className="min-h-0 flex-1 relative" data-ite-source>
              <SourceMonacoEditor
                value={sourceDocument || derived.sourceDocument}
                onChange={(next) => setSourceDocument(next)}
              />
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-8 px-4 flex items-center border-b border-editor-border bg-editor-bg">
            <span className="text-[11px] font-bold text-editor-muted uppercase tracking-wider">
              TRANSLATION
            </span>
          </div>
          <div className="min-h-0 flex-1 relative">
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
