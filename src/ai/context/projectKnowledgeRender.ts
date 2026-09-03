import type {
  ContextSnapshot,
  ForbiddenTerm,
  ProjectMemoryItem,
} from '@/types';
import { memoryItemLimit, selectMemoryItems } from './projectMemoryPolicy';

type RenderableMemoryItem = Pick<ProjectMemoryItem, 'category' | 'content'>;
type RenderableForbiddenTerm = Pick<ForbiddenTerm, 'term' | 'replacement' | 'note'>;

/**
 * 프로젝트 지식 섹션의 사용 지시문.
 *
 * 섹션 제목만 있고 "이걸 어떻게 쓰라"가 없으면 모델이 참고 목록으로 읽을지 지켜야 할
 * 기준으로 읽을지가 운에 달린다. 번역과 검수가 같은 문장을 보도록 여기 모은다.
 * 두 워크플로우가 같이 쓰므로 "번역하라"가 아니라 "기준이다"로 적는다.
 *
 * 폴리싱·선택 재번역은 프롬프트 전체가 영어라 각 파일에 영어로 둔다 — 한 문장을
 * 억지로 공유하려고 언어 파라미터를 만들면 프롬프트가 한/영 혼용이 된다.
 */
export const KNOWLEDGE_DIRECTIVES = {
  glossary: '아래 용어집의 번역이 이 프로젝트의 확정 번역입니다. 동의어로 대체하지 마세요.',
  forbiddenTerms: '아래 용어는 번역문에 쓸 수 없습니다. 대체어가 있으면 반드시 대체어를 사용하세요.',
  translationRules: '아래 번역 규칙이 이 프로젝트의 기준입니다. 일반적인 관례와 충돌하면 이 규칙을 우선합니다.',
  projectMemory:
    '아래는 배경 지식입니다. 용어 선택과 톤을 정하는 데만 사용하고, 이 내용을 번역문에 새로 추가하지 마세요.',
} as const;

/**
 * 금칙어와 용어집이 **같은 용어**에서 충돌할 때의 해소 규칙.
 *
 * 검수(`reviewTool.ts`의 Instruction priority)만 이 규칙을 갖고 있어서, 번역·폴리싱·선택
 * 경로는 삽입 순서상 뒤에 오는 용어집을 따르고 검수는 그것을 용어 불일치로 되잡는 루프가
 * 있었다. 네 경로가 같은 답을 내도록 규칙을 여기 모은다.
 *
 * 두 블록이 **모두 있을 때만** 붙인다 — 하나만 있으면 충돌이 성립하지 않는다.
 *
 * 위 `KNOWLEDGE_DIRECTIVES`와 달리 한/영을 나란히 둔다. 프롬프트가 영어인 폴리싱·선택도
 * 같은 규칙을 써야 하는데, 갈라 두면 정확히 이 발견이 다시 생긴다. 언어 파라미터를 만들지
 * 않는 이유는 종전과 같다(프롬프트가 한/영 혼용이 된다).
 */
export const FORBIDDEN_OVERRIDES_GLOSSARY_KO =
  '금지 용어의 대체어와 용어집 항목이 충돌하면 금지 용어의 대체어를 우선합니다. 그 용어에는 용어집 번역을 쓰지 마세요.';
export const FORBIDDEN_OVERRIDES_GLOSSARY_EN =
  'When a forbidden-term replacement conflicts with a glossary entry, the forbidden-term replacement wins. Never use the glossary translation for that term.';

export function formatMemoryLine(item: RenderableMemoryItem): string {
  return `- [${item.category}] ${item.content}`;
}

export function formatForbiddenTermLine(term: RenderableForbiddenTerm): string {
  return `- ${term.term}${term.replacement ? ` → ${term.replacement}` : ''}${
    term.note ? ` (${term.note})` : ''
  }`;
}

const DEFAULT_MAX_CHARS = 1_500;
const DEFAULT_MAX_FORBIDDEN_TERMS = 20;

export interface ChatMemoryDigestInput {
  items: ProjectMemoryItem[];
  forbiddenTerms: ForbiddenTerm[];
  maxItems?: number;
  maxChars?: number;
  maxForbiddenTerms?: number;
}

export interface ChatMemoryDigest {
  /** `[프로젝트 메모리]` 본문. 빈 문자열이면 주입하지 않는다. */
  projectMemory: string;
  /** `[금칙어]` 본문. 빈 문자열이면 주입하지 않는다. */
  forbiddenTerms: string;
  /** 실제 렌더링된 항목 ID (ContextManifest 기록용). */
  itemIds: string[];
  forbiddenTermIds: string[];
  /** 상한 때문에 빠진 항목이 있으면 true. */
  truncated: boolean;
}

/**
 * 일반 채팅 시스템 프롬프트에 넣을 승인된 프로젝트 지식의 압축 요약.
 *
 * 매 턴 반복 주입되므로 워크플로우보다 훨씬 빡빡한 상한을 적용한다. 상세가 필요하면
 * 모델이 `get_project_guidance`로 조회하도록 두고, 여기서는 "무엇을 알고 있어야 하는가"의
 * 최소 집합만 전달한다.
 */
export function renderChatMemoryDigest(input: ChatMemoryDigestInput): ChatMemoryDigest {
  const maxItems = input.maxItems ?? memoryItemLimit('general-chat');
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const maxForbiddenTerms = input.maxForbiddenTerms ?? DEFAULT_MAX_FORBIDDEN_TERMS;

  const activeItems = input.items.filter((item) => item.status === 'active');
  const { selected, droppedCount } = selectMemoryItems(activeItems, maxItems);

  const memoryLines: string[] = [];
  const itemIds: string[] = [];
  let usedChars = 0;
  let charBudgetExceeded = false;
  for (const item of selected) {
    const line = formatMemoryLine(item);
    // +1은 join('\n')이 추가할 개행.
    const nextChars = usedChars + line.length + (memoryLines.length > 0 ? 1 : 0);
    if (nextChars > maxChars) {
      charBudgetExceeded = true;
      break;
    }
    memoryLines.push(line);
    itemIds.push(item.id);
    usedChars = nextChars;
  }

  const enabledTerms = input.forbiddenTerms.filter((term) => term.enabled);
  const selectedTerms = enabledTerms.slice(0, maxForbiddenTerms);

  return {
    projectMemory: memoryLines.join('\n'),
    forbiddenTerms: selectedTerms.map(formatForbiddenTermLine).join('\n'),
    itemIds,
    forbiddenTermIds: selectedTerms.map((term) => term.id),
    truncated:
      droppedCount > 0
      || charBudgetExceeded
      || enabledTerms.length > selectedTerms.length,
  };
}

/**
 * ContextSnapshot의 메모리 항목을 워크플로우 프롬프트용으로 렌더링한다.
 * mode별 상한을 적용하고, 실제 주입된 항목 ID만 돌려준다.
 */
export function renderSnapshotMemory(
  items: ContextSnapshot['projectMemoryItems'],
  maxItems: number,
): { text: string; itemIds: string[]; droppedCount: number } {
  const { selected, droppedCount } = selectMemoryItems(items, maxItems);
  return {
    text: selected.map(formatMemoryLine).join('\n'),
    itemIds: selected.map((item) => item.id),
    droppedCount,
  };
}
