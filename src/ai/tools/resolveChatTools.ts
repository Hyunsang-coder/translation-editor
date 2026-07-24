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
  notionEnabled?: boolean;
  explicitDocumentReference?: boolean;
  explicitExternalReference?: boolean;
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
    case 'notion-enabled':
      return input.notionEnabled === true;
    case 'explicit-document-reference':
      return input.explicitDocumentReference === true;
    case 'explicit-external-reference':
      return input.explicitExternalReference === true;
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
