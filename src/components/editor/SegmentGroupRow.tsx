import { TranslationBlock } from '@/components/editor/TranslationBlock';
import { useProjectStore } from '@/stores/projectStore';
import { stripHtml } from '@/utils/hash';

interface SegmentGroupRowProps {
  segmentGroupId: string;
  focusMode: boolean;
  onNavigateToTarget?: (segmentGroupId: string) => void;
}

/**
 * SegmentGroup Row
 * 원문/번역 블록을 한 행에서 같이 렌더링하여 수직 정렬(Height Sync)을 보장합니다.
 */
export function SegmentGroupRow({
  segmentGroupId,
  focusMode,
  onNavigateToTarget,
}: SegmentGroupRowProps): JSX.Element {
  const { project, getBlocksBySegment } = useProjectStore();

  if (!project) {
    return <div />;
  }

  const sourceBlocks = getBlocksBySegment(segmentGroupId, 'source');
  const targetBlocks = getBlocksBySegment(segmentGroupId, 'target');

  const targetPreview = targetBlocks
    .map((b) => stripHtml(b.content))
    .filter((t) => t.length > 0)
    .join(' / ');

  return (
    <div
      className={`segment-group ${focusMode ? 'grid-cols-1' : 'grid-cols-2'}`}
      data-segment-group-id={segmentGroupId}
    >
      {/* Source column */}
      {!focusMode && (
        <div className="min-w-0" data-ite-source>
          {sourceBlocks.map((block) => (
            <TranslationBlock key={block.id} block={block} readOnly />
          ))}
        </div>
      )}

      {/* Target column */}
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onNavigateToTarget?.(segmentGroupId)}
          className="w-full text-left px-4 py-3 rounded-md border border-editor-border bg-editor-surface hover:bg-editor-bg transition-colors"
          title="해당 구간으로 이동"
        >
          <div className="text-xs text-editor-muted mb-1">Target (preview)</div>
          <div className="text-sm text-editor-text whitespace-pre-wrap">
            {targetPreview.length > 0 ? targetPreview : '(비어 있음)'}
          </div>
        </button>
      </div>
    </div>
  );
}


