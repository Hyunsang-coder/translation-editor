import { useProjectStore } from '@/stores/projectStore';
import { TranslationBlock } from '@/components/editor/TranslationBlock';

/**
 * 번역문 패널 컴포넌트
 * 편집 가능한 블록 기반 번역문 작성
 */
export function TargetPanel(): JSX.Element {
  const { project, getBlocksBySegment, updateBlock } = useProjectStore();

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-editor-muted">
        프로젝트를 불러오는 중...
      </div>
    );
  }

  const handleBlockChange = (blockId: string, content: string): void => {
    updateBlock(blockId, content);
  };

  return (
    <div className="h-full p-editor-padding">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-editor-muted uppercase tracking-wider">
          Target ({project.metadata.targetLanguage})
        </h2>
      </div>

      <div className="space-y-1">
        {project.segments.map((segment) => {
          const targetBlocks = getBlocksBySegment(segment.groupId, 'target');

          return (
            <div key={segment.groupId} className="border-b border-editor-border pb-2">
              {targetBlocks.map((block) => (
                <TranslationBlock
                  key={block.id}
                  block={block}
                  onChange={(content) => handleBlockChange(block.id, content)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

