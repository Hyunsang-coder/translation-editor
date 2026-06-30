import { invoke } from '@/tauri/invoke';
import type { UserComment, CommentField } from '@/stores/commentStore';

/**
 * Rust CommentRow와 1:1 대응하는 wire 타입(camelCase).
 * UserComment와 동일 형태이나, 영속 경계에서 명시적으로 분리해 둔다.
 */
interface CommentWireRow {
  id: string;
  field: CommentField;
  segmentGroupId: string | null;
  excerpt: string;
  comment: string;
  resolved: boolean;
  createdAt: number;
}

function toWire(c: UserComment): CommentWireRow {
  return {
    id: c.id,
    field: c.field,
    segmentGroupId: c.segmentGroupId ?? null,
    excerpt: c.excerpt,
    comment: c.comment,
    resolved: c.resolved,
    createdAt: c.createdAt,
  };
}

function fromWire(r: CommentWireRow): UserComment {
  return {
    id: r.id,
    field: r.field,
    segmentGroupId: r.segmentGroupId ?? undefined,
    excerpt: r.excerpt,
    comment: r.comment,
    resolved: r.resolved,
    createdAt: r.createdAt,
  };
}

/** 프로젝트 코멘트 전체 교체 저장 */
export async function saveComments(
  projectId: string,
  comments: UserComment[],
): Promise<void> {
  await invoke<void>('save_comments', {
    args: {
      projectId,
      comments: comments.map(toWire),
    },
  });
}

/** 프로젝트별 코멘트 로드 */
export async function loadComments(projectId: string): Promise<UserComment[]> {
  const rows = await invoke<CommentWireRow[]>('load_comments', {
    args: { projectId },
  });
  return rows.map(fromWire);
}
