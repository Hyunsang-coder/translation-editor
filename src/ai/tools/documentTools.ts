import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { stripHtml } from '@/utils/hash';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { buildTargetDocument } from '@/editor/targetDocument';

function resolveSourceDocumentText(): string {
  const { project, sourceDocument } = useProjectStore.getState();
  const raw = sourceDocument?.trim() ? sourceDocument : project ? buildSourceDocument(project).text : '';
  return raw ? stripHtml(raw) : '';
}

function resolveTargetDocumentText(): string {
  const { project, targetDocument } = useProjectStore.getState();
  const raw = targetDocument?.trim() ? targetDocument : project ? buildTargetDocument(project).text : '';
  return raw ? stripHtml(raw) : '';
}

export const getSourceDocumentTool = tool(
  async () => {
    return resolveSourceDocumentText();
  },
  {
    name: 'get_source_document',
    description:
      '원문(Source) 문서를 가져옵니다. 원문/번역문 비교나 검수에 꼭 필요할 때만 사용하세요.',
    schema: z.object({}),
  },
);

export const getTargetDocumentTool = tool(
  async () => {
    return resolveTargetDocumentText();
  },
  {
    name: 'get_target_document',
    description:
      '번역문(Target) 문서를 가져옵니다. 원문/번역문 비교나 검수에 꼭 필요할 때만 사용하세요.',
    schema: z.object({}),
  },
);


