import type {
  ProjectMemoryCategory,
  ProjectMemoryItem,
  WorkflowContextMode,
} from '@/types';

/**
 * 상한에 걸렸을 때 어떤 항목을 남길지 정하는 우선순위 (작을수록 우선).
 *
 * 카테고리를 배제하는 용도가 아니다. legacy projectContext 마이그레이션과 설정 UI의
 * 수동 추가가 모두 'general'로 들어오므로, 하드 제외는 사용자 데이터를 조용히 누락시킨다.
 */
export const MEMORY_CATEGORY_PRIORITY: Record<ProjectMemoryCategory, number> = {
  domain: 0,
  audience: 1,
  product: 2,
  worldbuilding: 3,
  character: 4,
  decision: 5,
  general: 6,
  intent: 7,
  reference_fact: 8,
};

/**
 * mode별 주입 항목 수 상한.
 * 채팅은 매 턴 반복 주입되므로 낮게, 1회성 문서 워크플로우는 넉넉하게 잡는다.
 */
export const MEMORY_ITEM_LIMITS: Record<WorkflowContextMode, number> = {
  'general-chat': 12,
  'selection-chat': 12,
  'full-translate': 40,
  'selection-retranslate': 20,
  review: 40,
  polish: 40,
};

export function memoryItemLimit(mode: WorkflowContextMode): number {
  return MEMORY_ITEM_LIMITS[mode];
}

export interface SelectMemoryItemsResult<T> {
  selected: T[];
  droppedCount: number;
}

/**
 * 사용자가 설정 화면에서 직접 입력한 항목은 카테고리보다 먼저 남긴다.
 *
 * 채팅 제안 승인(source='chat')도 사용자를 거치지만, 수동 입력은 기본 카테고리가 'general'
 * (우선순위 9개 중 7번째)로 굳어 있어 카테고리만 보면 손으로 친 항목이 항상 먼저 잘렸다.
 * 직접 타이핑이 가장 강한 의도 표시다.
 *
 * source가 없는 값은 비-user로 취급한다 — 이 필드가 생기기 전에 저장된 ContextSnapshot.
 */
function sourceTier(source: ProjectMemoryItem['source'] | undefined): number {
  return source === 'user' ? 0 : 1;
}

/**
 * 우선순위 상위 maxItems개만 남긴다.
 *
 * 반환 순서는 입력 순서(= DB created_at ASC, 설정 화면 표시 순서)를 유지한다.
 * 선별 기준과 표시 순서를 분리해야 프롬프트가 사용자가 보는 목록과 같은 흐름으로 읽힌다.
 */
export function selectMemoryItems<
  T extends {
    category: ProjectMemoryCategory;
    source?: ProjectMemoryItem['source'];
  },
>(
  items: T[],
  maxItems: number,
): SelectMemoryItemsResult<T> {
  if (maxItems <= 0) return { selected: [], droppedCount: items.length };
  if (items.length <= maxItems) return { selected: items, droppedCount: 0 };

  const kept = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const bySource = sourceTier(a.item.source) - sourceTier(b.item.source);
      if (bySource !== 0) return bySource;
      const byPriority =
        MEMORY_CATEGORY_PRIORITY[a.item.category] - MEMORY_CATEGORY_PRIORITY[b.item.category];
      if (byPriority !== 0) return byPriority;
      // 같은 우선순위면 최근 항목을 남긴다 (입력이 created_at ASC이므로 index가 클수록 최근).
      return b.index - a.index;
    })
    .slice(0, maxItems)
    .sort((a, b) => a.index - b.index);

  return {
    selected: kept.map((entry) => entry.item),
    droppedCount: items.length - kept.length,
  };
}
