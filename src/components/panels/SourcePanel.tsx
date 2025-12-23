import { useProjectStore } from '@/stores/projectStore';
import { TranslationBlock } from '@/components/editor/TranslationBlock';

/**
 * 원문 패널 컴포넌트
 * 읽기 전용 블록 기반 원문 표시
 */
export function SourcePanel(): JSX.Element {
  const { project, getBlocksBySegment } = useProjectStore();

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-editor-muted">
        프로젝트를 불러오는 중...
      </div>
    );
  }

  return (
    <div className="h-full p-editor-padding">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-editor-muted uppercase tracking-wider">
          Source
        </h2>
      </div>

      <div className="space-y-1">
        {project.segments.map((segment) => {
          const sourceBlocks = getBlocksBySegment(segment.groupId, 'source');

          return (
            <div key={segment.groupId} className="border-b border-editor-border pb-2">
              {sourceBlocks.map((block) => (
                <TranslationBlock
                  key={block.id}
                  block={block}
                  readOnly
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

