import { describe, expect, it } from 'vitest';
import { buildToolGuideMessage } from './chat';

describe('buildToolGuideMessage — 선택 프로필', () => {
  it('부분 검토는 전체 문서보다 정렬된 선택 문맥을 우선한다', () => {
    const guide = String(buildToolGuideMessage({
      profile: 'selection-target',
      boundToolNames: [
        'get_source_document',
        'get_target_document',
        'get_selection_surroundings',
        'get_aligned_selection_context',
      ],
    }).content);

    const partialReview = guide.indexOf('부분 검토/질문');
    const alignedSelection = guide.indexOf('get_aligned_selection_context', partialReview);
    expect(partialReview).toBeGreaterThanOrEqual(0);
    expect(alignedSelection).toBeGreaterThan(partialReview);
    expect(guide).not.toContain('get_source_document + get_target_document로 문서 조회 후 답변');
    expect(guide).toContain('전체 문서는 선택 문맥으로 답할 수 없을 때만');
  });

  it('웹 검색의 provider 내부 도구 이름을 사용자 지침에 노출하지 않는다', () => {
    const guide = String(buildToolGuideMessage({
      profile: 'general',
      boundToolNames: ['web_search'],
    }).content);

    expect(guide).toContain('내장 웹 검색');
    expect(guide).not.toContain('web_search_preview');
    expect(guide).not.toContain('web_search_20250305');
  });
});
