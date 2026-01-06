import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { stripHtml } from '@/utils/hash';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { buildTargetDocument } from '@/editor/targetDocument';
import { searchGlossary } from '@/tauri/glossary';

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

// 큰 문서 처리 (documentTools.ts와 동일한 로직)
function autoSliceLargeDocument(text: string, maxChars: number): string {
  const t = text ?? '';
  if (t.length <= maxChars) return t;

  // head+tail 방식으로 앞뒤 맥락 확보
  const marker = '\n...\n';
  const budget = Math.max(0, maxChars - marker.length);
  const headLen = Math.floor(budget * 0.62);
  const tailLen = Math.max(0, budget - headLen);
  const head = t.slice(0, headLen);
  const tail = tailLen > 0 ? t.slice(Math.max(0, t.length - tailLen)) : '';
  return `${head}${marker}${tail}`;
}

const REVIEW_INSTRUCTIONS = `다음 원문과 번역문을 비교하여 **중대한 오류만** 검수하세요.

[검수 우선순위]
1. 누락: 원문에는 있으나 번역문에서 빠진 내용
2. 명백한 오역: 의미 반전/주체·객체·조건·부정/수치·단위·시간이 바뀐 경우
3. 고유명사/용어 오류: 의미 혼동을 유발하는 경우

[검수 지침]
- 애매하거나 논쟁적인 판단은 지적하지 않습니다.
- 스타일/어감/문체/자연스러움 차이, 대안 번역 제안은 금지합니다.
- 각 이슈는 원문/번역문 해당 부분을 인용해 1~2문장으로 간단히 설명하세요.
- 이슈가 없으면 "중대한 문제 없음"이라고만 답하세요.

[참고 자료 활용]
- Translation Rules: 번역 스타일/포맷/문체 규칙을 확인하여 번역문이 규칙을 따르는지 검사하세요
- Project Context: 프로젝트 배경 지식/맥락 정보를 참고하여 번역이 맥락에 맞는지 확인하세요
- Glossary: 용어집에 정의된 용어가 번역문에서 올바르게 사용되었는지, 일관되게 사용되었는지 체크하세요
- Attachments: 첨부된 참고 자료가 있다면 번역의 정확성과 맥락 적합성을 검증하는 데 활용하세요`;

const ReviewToolArgsSchema = z.object({
  maxChars: z.number().int().min(2000).max(30000).optional().describe('원문/번역문 각각 반환할 최대 문자 수 (기본 12000)'),
});

/**
 * 번역 검수 도구
 * 원문과 번역문을 가져와서 검수 지침과 함께 반환합니다.
 * Translation Rules, Project Context, Glossary, Attachments도 함께 포함합니다.
 * 메인 모델이 이 데이터를 분석하여 검수 결과를 생성합니다.
 */
export const reviewTranslationTool = tool(
  async (rawArgs) => {
    const args = ReviewToolArgsSchema.safeParse(rawArgs ?? {});
    const parsed = args.success ? args.data : {};
    const maxChars = parsed.maxChars ?? 12000;

    const sourceText = resolveSourceDocumentText();
    const targetText = resolveTargetDocumentText();

    if (!sourceText || !targetText) {
      throw new Error('원문 또는 번역문이 없습니다. 문서를 먼저 로드해주세요.');
    }

    // 큰 문서는 자동으로 잘라서 반환
    const slicedSource = autoSliceLargeDocument(sourceText, maxChars);
    const slicedTarget = autoSliceLargeDocument(targetText, maxChars);

    // Translation Rules, Project Context, Attachments 가져오기
    const { translationRules, projectContext, attachments } = useChatStore.getState();
    const { project } = useProjectStore.getState();

    // Glossary 검색 (원문/번역문 기반)
    let glossaryText = '';
    try {
      if (project?.id) {
        const query = [slicedSource, slicedTarget].filter(Boolean).join('\n').slice(0, 2000);
        if (query.trim().length > 0) {
          const hits = await searchGlossary({
            projectId: project.id,
            query,
            domain: project.metadata.domain,
            limit: 20, // 검수용이므로 더 많이 가져옴
          });
          if (hits.length > 0) {
            glossaryText = hits
              .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
              .join('\n');
          }
        }
      }
    } catch {
      // Glossary 검색 실패 시 무시
    }

    // Attachments 텍스트 추출
    const attachmentsText = attachments
      ?.filter((a) => a.extractedText)
      .map((a) => `[${a.filename}]\n${a.extractedText}`)
      .join('\n\n') || '';

    return {
      instructions: REVIEW_INSTRUCTIONS,
      sourceText: slicedSource,
      targetText: slicedTarget,
      translationRules: translationRules?.trim() || undefined,
      projectContext: projectContext?.trim() || undefined,
      glossary: glossaryText || undefined,
      attachments: attachmentsText || undefined,
      note: sourceText.length > maxChars || targetText.length > maxChars
        ? '문서가 길어 일부만 표시되었습니다. 전체 검수가 필요하면 maxChars를 늘려주세요.'
        : undefined,
    };
  },
  {
    name: 'review_translation',
    description:
      '원문과 번역문을 비교하여 번역 품질을 검수합니다. ' +
      '누락, 오역, 용어 일관성 문제를 찾아 지적합니다. ' +
      '이 도구는 원문/번역문을 가져와 검수 지침과 함께 반환하며, 모델이 이를 분석하여 검수 결과를 생성합니다.',
    schema: ReviewToolArgsSchema,
  },
);
