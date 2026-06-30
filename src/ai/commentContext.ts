import type { CommentField, UserComment } from '@/stores/commentStore';

export interface SerializeUserCommentsOptions {
  /** 특정 필드(source/target)만 포함. 미지정 시 전체. */
  field?: CommentField;
  /** 헤더 다음 안내 문구 교체. 미지정 시 번역용 기본 문구. */
  leadIn?: string;
  /**
   * segmentGroupId 화이트리스트. 지정 시, segmentGroupId가 있는 코멘트는
   * 이 집합에 포함될 때만 통과(특정 청크/세그먼트 범위로 한정).
   * segmentGroupId가 없는 코멘트는 항상 포함.
   */
  segmentGroupIds?: Set<string>;
}

/**
 * 사용자 코멘트를 LLM 프롬프트용 텍스트 섹션으로 직렬화.
 * resolved=true 코멘트는 제외. excerpt(인용) 기반 앵커링(reviewIssues 선례 차용).
 * 반환: 코멘트가 없으면 빈 문자열, 있으면 헤더 포함 블록.
 *
 * @param options.field  특정 필드만 포함(폴리싱은 target만 다루므로 사용).
 * @param options.leadIn 안내 문구 교체(워크플로우별 표현 — 번역/폴리싱 등).
 */
export function serializeUserComments(
  comments: UserComment[],
  options: SerializeUserCommentsOptions = {},
): string {
  const { field, segmentGroupIds } = options;
  const entries = comments
    .filter((c) => c.resolved !== true)
    .filter((c) => (field ? c.field === field : true))
    .filter((c) => {
      // segmentGroupId 화이트리스트: id가 있는 코멘트만 검사, 없으면 항상 통과
      if (!segmentGroupIds || !c.segmentGroupId) return true;
      return segmentGroupIds.has(c.segmentGroupId);
    })
    .map((c) => ({ excerpt: c.excerpt.trim(), comment: c.comment.trim() }))
    .filter((c) => c.excerpt !== '' && c.comment !== '');

  if (entries.length === 0) {
    return '';
  }

  const lines = entries.map(
    (c, idx) => `${idx + 1}. "${c.excerpt}" — ${c.comment}`
  );

  const leadIn = options.leadIn
    ?? '아래는 번역가가 특정 구절에 남긴 코멘트입니다. 번역 시 반드시 반영하세요:';

  return [
    '[사용자 코멘트]',
    leadIn,
    ...lines,
  ].join('\n');
}
