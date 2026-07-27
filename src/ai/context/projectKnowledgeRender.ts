import type {
  ContextSnapshot,
  ForbiddenTerm,
  ProjectMemoryItem,
} from '@/types';
import { memoryItemLimit, selectMemoryItems } from './projectMemoryPolicy';

type RenderableMemoryItem = Pick<ProjectMemoryItem, 'category' | 'content'>;
type RenderableForbiddenTerm = Pick<ForbiddenTerm, 'term' | 'replacement' | 'note'>;

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
