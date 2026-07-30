/**
 * 프로필과 실행 조건으로 이번 요청에 바인딩할 도구 이름을 정한다.
 *
 * 사용자 메시지 내용(정규식 등)으로는 도구를 켜고 끄지 않는다. Anthropic 프리픽스는
 * tools → system → messages 순으로 렌더되므로, 메시지마다 도구 목록이 흔들리면 그 뒤의
 * system·대화 이력 캐시가 전부 무효화된다. 도구 설명 토큰은 한 번 캐시되면 재사용되지만,
 * 목록이 바뀌면 매 턴 프리픽스 전체를 정가로 다시 낸다.
 */
import type { ChatToolProfile, ChatToolRequirement } from '@/types';
import { CHAT_TOOL_REGISTRY } from './toolRegistry';

export interface ResolveChatToolNamesInput {
  profile: ChatToolProfile;
  hasProject?: boolean;
  hasSourceSelection?: boolean;
  hasTargetSelection?: boolean;
  hasReviewResults?: boolean;
  webEnabled?: boolean;
  confluenceEnabled?: boolean;
}

function requirementSatisfied(
  requirement: ChatToolRequirement,
  input: ResolveChatToolNamesInput,
): boolean {
  switch (requirement) {
    case 'project':
      return input.hasProject === true;
    case 'source-selection':
      return input.hasSourceSelection === true;
    case 'target-selection':
      return input.hasTargetSelection === true;
    case 'review-results':
      return input.hasReviewResults === true;
    case 'web-enabled':
      return input.webEnabled === true;
    case 'confluence-enabled':
      return input.confluenceEnabled === true;
  }
}

export function resolveChatToolNames(input: ResolveChatToolNamesInput): string[] {
  if (input.profile === 'selection-retranslate') return [];

  return CHAT_TOOL_REGISTRY
    .filter((descriptor) => descriptor.profiles.includes(input.profile))
    .filter((descriptor) =>
      (descriptor.requires ?? []).every((requirement) =>
        requirementSatisfied(requirement, input),
      ),
    )
    .map((descriptor) => descriptor.name);
}
