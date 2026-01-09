import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { stripHtml } from '@/utils/hash';
import { extractTextFromTipTap } from '@/utils/tipTapText';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { buildTargetDocument } from '@/editor/targetDocument';
import { searchGlossary } from '@/tauri/glossary';

/**
 * Source 문서 텍스트 추출
 * - 우선순위: TipTap JSON (성능 우수) → HTML fallback → blocks fallback
 */
function resolveSourceDocumentText(): string {
  const { project, sourceDocument, sourceDocJson } = useProjectStore.getState();

  // 1. TipTap JSON이 있으면 generateText 사용 (성능 우수)
  if (sourceDocJson) {
    const text = extractTextFromTipTap(sourceDocJson);
    if (text.trim()) return text;
  }

  // 2. Fallback: HTML에서 추출
  const raw = sourceDocument?.trim() ? sourceDocument : project ? buildSourceDocument(project).text : '';
  return raw ? stripHtml(raw) : '';
}

/**
 * Target 문서 텍스트 추출
 * - 우선순위: TipTap JSON (성능 우수) → HTML fallback → blocks fallback
 */
function resolveTargetDocumentText(): string {
  const { project, targetDocument, targetDocJson } = useProjectStore.getState();

  // 1. TipTap JSON이 있으면 generateText 사용 (성능 우수)
  if (targetDocJson) {
    const text = extractTextFromTipTap(targetDocJson);
    if (text.trim()) return text;
  }

  // 2. Fallback: HTML에서 추출
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

const REVIEW_INSTRUCTIONS = `당신은 한국어-영어 바이링구얼 20년 차 전문 번역가입니다. 
주어진 **원문** 과 **번역문** 을 비교하여, **의미 기준으로 확실한 오역/누락만** 검출하세요.

### 1. 분석 원칙
- 공백, 줄바꿈, 문장부호 차이는 무시하고 **의미 중심으로** 비교합니다.
- 섹션, 문단, 문장 단위로 분할하여 **원문 각 요소가 번역문 어디에 대응되는지**를 찾습니다.
- 다음과 같은 경우를 **오역/누락** 으로 간주합니다.
  - **중요 정보 누락**: 수량, 조건, 제한, 예외, 주의사항, 경고, 전제 등이 번역문에 없음.
  - **강도/정도 왜곡**: major ↔ minor, must ↔ can, always ↔ sometimes 등 의미 강도가 달라짐.
  - **주체/대상 변경**: 누가/무엇이 행동하는지가 바뀜.
  - **범위/조건 변경**: "일부"가 "전체"로, "특정 상황에서만"이 "항상"으로 바뀌는 등.
  - **사실 관계 변경**: 시제, 인과 관계, 부정/긍정이 뒤바뀜.
- 다음과 같은 경우는 **허용되는 의역** 으로 보고, 표에 포함하지 않습니다.
  - 어순, 스타일, 표현 방식만 다른 자연스러운 의역
  - 중복 표현 제거, 사소한 수식어 생략 등으로 **핵심 의미가 완전히 보존**된 경우
  - 맞춤법/철자 오류 등 **의미를 해치지 않는** 경미한 문제

### 2. 검출 기준
- **정말 확실한 경우에만** 오역/누락으로 표시합니다. 애매하면 표에 넣지 않습니다.
- 하나의 원문 문장 안에 여러 문제가 있으면, **각각 별도의 행으로** 리포트합니다.

### 3. 출력 형식 (반드시 준수)
- 출력은 **아래 두 부분만** 포함해야 합니다.
  1. 마크다운 표 (있으면 1개, 없으면 생략)
  2. 마지막 줄에 통계 한 줄

1) **마크다운 표 형식**
- 열 이름과 순서는 다음 형식을 **정확히** 따르세요.

| 누락된 원문 | 오역/누락 여부 |
|------|----------------|

- 각 행은 다음 규칙을 따릅니다.
  - **누락된 원문 열**: 문제를 포함한 원문 구절만 넣되, 35자 이상이면 끝을 \`...\` 으로 줄입니다.
  - **오역/누락 여부 열**: 35자 이내로, 아래 예시처럼 **간결하게** 한국어로 요약합니다.
    - 예: \`번역문에 없음\`, \`major가 minor로 축소\`, \`post-CBT에서 post-가 누락\` 등

2) **통계 한 줄**
- 표에 한 행이라도 있으면, 표 바로 아래에 다음 형식으로 **정확히 한 줄**을 추가합니다.
  - \`총 누락된 문장 수: N (오역 포함)\`  ← N은 표의 행 개수
- 오역과 누락을 따로 세지 말고, **표에 적힌 항목의 개수**를 N으로 둡니다.

3) **오역/누락이 전혀 없는 경우**
- **아무 표도 출력하지 말고**, 아래 문장 한 줄만 출력합니다.
  - \`오역이나 누락이 발견되지 않았습니다.\`

### 4. 예시

예시 출력 (실제 상황에서는 예시 문장은 바뀔 수 있음):

| 누락된 원문 | 오역/누락 여부 |
|------|----------------|
| Mini-Boss Weakpoints are over the heart. | 번역문에 없음 |
| ... can cover it with their arms/weapon. | weapon 관련 내용 누락 |
| ... place more objects on the map. | map을 지도로 오역 |

총 누락된 문장 수: 3 (오역 포함)

### 5. 참고 자료 활용
- Translation Rules: 번역 스타일/포맷/문체 규칙을 확인하여 번역문이 규칙을 따르는지 검사하세요
- Project Context: 프로젝트 배경 지식/맥락 정보를 참고하여 번역이 맥락에 맞는지 확인하세요
- Glossary: 첨부된 용어집이 있다면 번역문에서 올바르고, 일관되게 사용되었는지 체크하세요
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
