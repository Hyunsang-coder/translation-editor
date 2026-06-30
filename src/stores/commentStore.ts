import { create } from 'zustand';

// ============================================
// Comment Types
// ============================================

export type CommentField = 'source' | 'target';

export interface UserComment {
  id: string;                    // 결정적 ID (마크 attrs commentId와 동일)
  field: CommentField;           // source/target 에디터 구분
  segmentGroupId?: string | undefined;  // 블록 범위 한정(중복 구절 모호성 완화) - reviewStore 선례
  excerpt: string;               // 마킹된 텍스트(인용) - LLM 앵커링용
  comment: string;               // 코멘트 본문
  resolved: boolean;             // 해결 여부(해결 시 LLM 주입에서 제외)
  createdAt: number;             // 생성 시각(ms)
}

/**
 * 코멘트 ID 생성 (djb2 32-bit) — reviewStore.generateIssueId 패턴 차용.
 * field + excerpt + createdAt로 결정적 ID 생성(같은 구절에 다른 코멘트 허용).
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function generateCommentId(
  field: CommentField,
  excerpt: string,
  createdAt: number,
): string {
  return `cmt_${hashContent(`${field}|${excerpt}|${createdAt}`)}`;
}

// ============================================
// Store
// ============================================

interface CommentState {
  comments: UserComment[];
}

interface CommentActions {
  /** 코멘트 추가 후 생성된 항목 반환 */
  addComment: (input: {
    field: CommentField;
    excerpt: string;
    comment: string;
    segmentGroupId?: string;
    createdAt?: number;
  }) => UserComment;
  updateComment: (id: string, patch: Partial<Pick<UserComment, 'comment' | 'excerpt' | 'resolved'>>) => void;
  removeComment: (id: string) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  /** 영속 로드/전체 교체 */
  setComments: (comments: UserComment[]) => void;
  /** field별 코멘트 조회(미해결 우선 정렬 없이 생성순) */
  getCommentsForField: (field: CommentField) => UserComment[];
  getComment: (id: string) => UserComment | undefined;
  /** 고아 코멘트 정리: 살아있는 commentId 집합에 없는 항목 제거 */
  pruneOrphans: (liveIds: Set<string>) => void;
  clear: () => void;
}

export const useCommentStore = create<CommentState & CommentActions>((set, get) => ({
  comments: [],

  addComment: (input) => {
    const createdAt = input.createdAt ?? Date.now();
    const newComment: UserComment = {
      id: generateCommentId(input.field, input.excerpt, createdAt),
      field: input.field,
      segmentGroupId: input.segmentGroupId,
      excerpt: input.excerpt,
      comment: input.comment,
      resolved: false,
      createdAt,
    };
    set((state) => {
      // 동일 id 충돌 시 덮어쓰기 방지: 이미 있으면 교체
      const filtered = state.comments.filter((c) => c.id !== newComment.id);
      return { comments: [...filtered, newComment] };
    });
    return newComment;
  },

  updateComment: (id, patch) => {
    set((state) => ({
      comments: state.comments.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  },

  removeComment: (id) => {
    set((state) => ({ comments: state.comments.filter((c) => c.id !== id) }));
  },

  resolveComment: (id, resolved) => {
    set((state) => ({
      comments: state.comments.map((c) => (c.id === id ? { ...c, resolved } : c)),
    }));
  },

  setComments: (comments) => set({ comments }),

  getCommentsForField: (field) => get().comments.filter((c) => c.field === field),

  getComment: (id) => get().comments.find((c) => c.id === id),

  pruneOrphans: (liveIds) => {
    set((state) => ({ comments: state.comments.filter((c) => liveIds.has(c.id)) }));
  },

  clear: () => set({ comments: [] }),
}));
