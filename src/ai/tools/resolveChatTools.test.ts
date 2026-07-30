import { describe, expect, it } from 'vitest';
import { CHAT_TOOL_REGISTRY } from './toolRegistry';
import { resolveChatToolNames } from './resolveChatTools';

describe('resolveChatToolNames', () => {
  it('general profile에는 기본 문서 조회와 프로젝트 제안 도구를 제공한다', () => {
    const names = resolveChatToolNames({
      profile: 'general',
      hasProject: true,
    });

    expect(names).toContain('get_source_document');
    expect(names).toContain('get_target_document');
    expect(names).toContain('propose_project_memory_change');
    expect(names).not.toContain('propose_selection_edit');
  });

  it('selection-source profile에는 조회 도구만 있고 문서 수정 제안은 없다', () => {
    const names = resolveChatToolNames({
      profile: 'selection-source',
      hasProject: true,
      hasSourceSelection: true,
    });

    expect(names).toContain('get_selection_surroundings');
    // 원문을 고르고 "번역이 어떻게 됐어?"를 물을 수 있어야 한다.
    expect(names).toContain('get_aligned_selection_context');
    expect(names).not.toContain('propose_selection_edit');
    // 대조는 선택 구간으로 한정한다 — 번역문 전체 조회는 여전히 없다.
    expect(names).not.toContain('get_target_document');
  });

  it('selection-target profile에는 연결 원문 조회와 수정 제안이 있다', () => {
    const names = resolveChatToolNames({
      profile: 'selection-target',
      hasProject: true,
      hasTargetSelection: true,
    });

    expect(names).toContain('get_selection_surroundings');
    expect(names).toContain('get_aligned_selection_context');
    expect(names).toContain('propose_selection_edit');
  });

  it('selection-retranslate profile에는 도구를 하나도 바인딩하지 않는다', () => {
    expect(resolveChatToolNames({
      profile: 'selection-retranslate',
      hasProject: true,
      hasTargetSelection: true,
      hasReviewResults: true,
      webEnabled: true,
      confluenceEnabled: true,
      notionEnabled: true,
    })).toEqual([]);
  });

  it('검수 결과가 없으면 get_review_results를 노출하지 않는다', () => {
    const withoutResults = resolveChatToolNames({
      profile: 'general',
      hasProject: true,
    });
    const withResults = resolveChatToolNames({
      profile: 'general',
      hasProject: true,
      hasReviewResults: true,
    });

    expect(withoutResults).not.toContain('get_review_results');
    expect(withResults).toContain('get_review_results');
  });

  it('selection profile에는 Confluence 문서 쓰기 도구를 노출하지 않는다', () => {
    const names = resolveChatToolNames({
      profile: 'selection-target',
      hasProject: true,
      hasTargetSelection: true,
      confluenceEnabled: true,
    });

    expect(names).not.toContain('confluence_load_page');
  });

  it('같은 프로필·설정이면 사용자 메시지와 무관하게 도구 목록이 동일하다', () => {
    // tools는 system보다 앞에 렌더되므로, 메시지 내용에 따라 목록이 흔들리면
    // 그 뒤의 프리픽스 캐시가 매 턴 무효화된다.
    const config = {
      profile: 'general' as const,
      hasProject: true,
      webEnabled: true,
      confluenceEnabled: true,
      notionEnabled: true,
    };

    expect(resolveChatToolNames(config)).toEqual(resolveChatToolNames(config));
    expect(resolveChatToolNames(config)).toContain('get_source_document');
    expect(resolveChatToolNames(config)).toContain('web_search');
  });

  it('registry의 모든 도구는 UI 표시명과 trust/effect 분류를 가진다', () => {
    for (const descriptor of CHAT_TOOL_REGISTRY) {
      expect(descriptor.displayNameKey).toBeTruthy();
      expect(descriptor.trust).toMatch(/^(internal|document|external)$/);
      expect(descriptor.effect).toMatch(/^(read|external-read|proposal|document-write)$/);
      expect(descriptor.maxOutputChars).toBeGreaterThan(0);
    }
  });
});
