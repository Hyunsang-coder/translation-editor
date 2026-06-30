import type { UserComment } from '@/stores/commentStore';

/**
 * 사용자 코멘트를 LLM 프롬프트용 텍스트 섹션으로 직렬화.
 * resolved=true 코멘트는 제외. excerpt(인용) 기반 앵커링(reviewIssues 선례 차용).
 * 반환: 코멘트가 없으면 빈 문자열, 있으면 헤더 포함 블록.
 */
export function serializeUserComments(comments: UserComment[]): string {
  const entries = comments
    .filter((c) => c.resolved !== true)
    .map((c) => ({ excerpt: c.excerpt.trim(), comment: c.comment.trim() }))
    .filter((c) => c.excerpt !== '' && c.comment !== '');

  if (entries.length === 0) {
    return '';
  }

  const lines = entries.map(
    (c, idx) => `${idx + 1}. "${c.excerpt}" — ${c.comment}`
  );

  return [
    '[사용자 코멘트]',
    '아래는 번역가가 특정 구절에 남긴 코멘트입니다. 번역 시 반드시 반영하세요:',
    ...lines,
  ].join('\n');
}
