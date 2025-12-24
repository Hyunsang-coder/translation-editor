import { useMemo } from 'react';
import { calculateDiff, diffToHtml, diffToOriginalHtml, diffToSuggestedHtml } from '@/utils/diff';

interface VisualDiffViewerProps {
  original: string;
  suggested: string;
  className?: string;
  onAccept?: () => void;
  onReject?: () => void;
  acceptLabel?: string;
  rejectLabel?: string;
}

export function VisualDiffViewer({
  original,
  suggested,
  className = '',
  onAccept,
  onReject,
  acceptLabel = '적용하기',
  rejectLabel = '초기화',
}: VisualDiffViewerProps) {
  const changes = useMemo(() => calculateDiff(original, suggested), [original, suggested]);

  const originalHtml = useMemo(() => diffToOriginalHtml(changes), [changes]);
  const suggestedHtml = useMemo(() => diffToSuggestedHtml(changes), [changes]);
  
  // 통합 뷰 (필요 시 상단에 표시 가능)
  // const combinedHtml = useMemo(() => diffToHtml(changes), [changes]);

  const textStyle = "whitespace-pre-wrap font-mono text-sm leading-relaxed p-4 h-full overflow-auto outline-none";

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Split View */}
      <div className="flex gap-4 flex-1 min-h-0">
        
        {/* Left: Original with Deletions */}
        <div className="flex-1 flex flex-col border border-editor-border rounded-lg bg-editor-bg overflow-hidden shadow-sm">
          <div className="bg-editor-surface border-b border-editor-border px-4 py-2 text-sm font-medium text-editor-muted flex justify-between items-center">
             <span>원문 텍스트</span>
          </div>
          <div 
            className={`${textStyle} text-editor-text`}
            dangerouslySetInnerHTML={{ __html: originalHtml }} 
          />
        </div>

        {/* Center: Controls (if provided) */}
        {(onAccept || onReject) && (
          <div className="flex flex-col justify-center gap-3 shrink-0 px-2">
            {onAccept && (
              <button
                onClick={onAccept}
                className="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm whitespace-nowrap"
              >
                {acceptLabel}
              </button>
            )}
            {onReject && (
              <button
                onClick={onReject}
                className="bg-editor-surface hover:bg-editor-border text-editor-text border border-editor-border px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm whitespace-nowrap"
              >
                {rejectLabel}
              </button>
            )}
          </div>
        )}

        {/* Right: Suggested with Insertions */}
        <div className="flex-1 flex flex-col border border-editor-border rounded-lg bg-editor-bg overflow-hidden shadow-sm">
           <div className="bg-editor-surface border-b border-editor-border px-4 py-2 text-sm font-medium text-editor-muted flex justify-between items-center">
             <span>변경된 텍스트</span>
           </div>
           <div 
             className={`${textStyle} text-editor-text`}
             dangerouslySetInnerHTML={{ __html: suggestedHtml }} 
           />
        </div>

      </div>
    </div>
  );
}

