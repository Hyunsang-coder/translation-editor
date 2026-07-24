import type { ChatToolDescriptor } from '@/types';

const PROJECT_PROFILES: ChatToolDescriptor['profiles'] = [
  'general',
  'selection-source',
  'selection-target',
];

export const CHAT_TOOL_REGISTRY: readonly ChatToolDescriptor[] = [
  {
    name: 'get_source_document',
    profiles: PROJECT_PROFILES,
    effect: 'read',
    trust: 'document',
    maxOutputChars: 8_000,
    displayNameKey: 'chat.toolName.getSourceDocument',
    requires: ['project', 'explicit-document-reference'],
  },
  {
    name: 'get_target_document',
    profiles: ['general', 'selection-target'],
    effect: 'read',
    trust: 'document',
    maxOutputChars: 8_000,
    displayNameKey: 'chat.toolName.getTargetDocument',
    requires: ['project', 'explicit-document-reference'],
  },
  {
    name: 'get_selection_surroundings',
    profiles: ['selection-source', 'selection-target'],
    effect: 'read',
    trust: 'document',
    maxOutputChars: 4_000,
    displayNameKey: 'chat.toolName.getSelectionSurroundings',
    requires: ['project'],
  },
  {
    name: 'get_aligned_selection_context',
    profiles: ['selection-target'],
    effect: 'read',
    trust: 'document',
    maxOutputChars: 6_000,
    displayNameKey: 'chat.toolName.getAlignedSelectionContext',
    requires: ['project', 'target-selection'],
  },
  {
    name: 'get_review_results',
    profiles: PROJECT_PROFILES,
    effect: 'read',
    trust: 'internal',
    maxOutputChars: 8_000,
    displayNameKey: 'chat.toolName.getReviewResults',
    requires: ['project', 'review-results'],
  },
  {
    name: 'get_project_guidance',
    profiles: PROJECT_PROFILES,
    effect: 'read',
    trust: 'internal',
    maxOutputChars: 6_000,
    displayNameKey: 'chat.toolName.getProjectGuidance',
    requires: ['project'],
  },
  {
    name: 'search_project_glossary',
    profiles: PROJECT_PROFILES,
    effect: 'read',
    trust: 'internal',
    maxOutputChars: 4_000,
    displayNameKey: 'chat.toolName.searchProjectGlossary',
    requires: ['project'],
  },
  {
    name: 'propose_selection_edit',
    profiles: ['selection-target'],
    effect: 'proposal',
    trust: 'internal',
    maxOutputChars: 256,
    displayNameKey: 'chat.toolName.proposeSelectionEdit',
    requires: ['project', 'target-selection'],
  },
  {
    name: 'propose_project_memory_change',
    profiles: PROJECT_PROFILES,
    effect: 'proposal',
    trust: 'internal',
    maxOutputChars: 256,
    displayNameKey: 'chat.toolName.proposeProjectMemoryChange',
    requires: ['project'],
  },
  {
    name: 'suggest_translation_rule',
    profiles: PROJECT_PROFILES,
    effect: 'proposal',
    trust: 'internal',
    maxOutputChars: 256,
    displayNameKey: 'chat.toolName.suggestTranslationRule',
    requires: ['project'],
  },
  {
    name: 'suggest_forbidden_term',
    profiles: PROJECT_PROFILES,
    effect: 'proposal',
    trust: 'internal',
    maxOutputChars: 256,
    displayNameKey: 'chat.toolName.suggestForbiddenTerm',
    requires: ['project'],
  },
  {
    name: 'suggest_glossary_entry',
    profiles: PROJECT_PROFILES,
    effect: 'proposal',
    trust: 'internal',
    maxOutputChars: 256,
    displayNameKey: 'chat.toolName.suggestGlossaryEntry',
    requires: ['project'],
  },
  {
    name: 'web_search',
    profiles: PROJECT_PROFILES,
    effect: 'external-read',
    trust: 'external',
    maxOutputChars: 8_000,
    displayNameKey: 'chat.toolName.webSearch',
    requires: ['web-enabled', 'explicit-external-reference'],
  },
  {
    name: 'confluence_word_count',
    profiles: PROJECT_PROFILES,
    effect: 'external-read',
    trust: 'external',
    maxOutputChars: 4_000,
    displayNameKey: 'chat.toolName.confluenceWordCount',
    requires: ['confluence-enabled', 'explicit-external-reference'],
  },
  {
    name: 'confluence_load_page',
    profiles: ['general'],
    effect: 'document-write',
    trust: 'external',
    maxOutputChars: 2_000,
    displayNameKey: 'chat.toolName.confluenceLoadPage',
    requires: ['confluence-enabled', 'explicit-external-reference'],
  },
  {
    name: 'notion_search',
    profiles: PROJECT_PROFILES,
    effect: 'external-read',
    trust: 'external',
    maxOutputChars: 8_000,
    displayNameKey: 'chat.toolName.notionSearch',
    requires: ['notion-enabled', 'explicit-external-reference'],
  },
] as const;

const BY_NAME = new Map(CHAT_TOOL_REGISTRY.map((descriptor) => [descriptor.name, descriptor]));

export function getChatToolDescriptor(name: string): ChatToolDescriptor | undefined {
  return BY_NAME.get(name);
}

export function getChatToolDisplayNameKey(name: string): string | undefined {
  return getChatToolDescriptor(name)?.displayNameKey;
}
