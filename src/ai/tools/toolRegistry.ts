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
    requires: ['project'],
  },
  {
    name: 'get_target_document',
    profiles: ['general', 'selection-target'],
    effect: 'read',
    trust: 'document',
    maxOutputChars: 8_000,
    displayNameKey: 'chat.toolName.getTargetDocument',
    requires: ['project'],
  },
  {
    name: 'get_selection_surroundings',
    profiles: ['selection-source', 'selection-target'],
    effect: 'read',
    trust: 'document',
    // 선택 주변은 문서 전체 조회(8,000)보다 더 조여둘 이유가 없다. 프롬프트가
    // 전체 조회 대신 이 도구를 쓰라고 유도하는데 창이 더 좁으면 앞뒤가 맞지 않는다.
    maxOutputChars: 8_000,
    displayNameKey: 'chat.toolName.getSelectionSurroundings',
    requires: ['project'],
  },
  {
    name: 'get_aligned_selection_context',
    // Source 선택에서도 번역문 대조가 필요하다("이 문장 번역이 어떻게 됐어?").
    profiles: ['selection-source', 'selection-target'],
    effect: 'read',
    trust: 'document',
    // 같은 구간을 두 언어로 담으므로 다른 문서 도구의 2배가 필요하다.
    maxOutputChars: 16_000,
    displayNameKey: 'chat.toolName.getAlignedSelectionContext',
    requires: ['project'],
  },
  {
    // 문서 전체 검수. 첫 청크 + 검수 지침을 함께 돌려주므로 출력이 크다 —
    // 청크 상한(DEFAULT_REVIEW_CHUNK_SIZE 12,000자)에 지침·용어집을 더한 값을 잡는다.
    // 세그먼트는 원문/번역문 쌍이라 문서 조회 도구와 달리 짝이 맞은 채로 온다.
    name: 'review_translation',
    profiles: ['general'],
    effect: 'read',
    trust: 'document',
    maxOutputChars: 24_000,
    displayNameKey: 'chat.toolName.reviewTranslation',
    requires: ['project'],
  },
  {
    name: 'get_review_chunk',
    profiles: ['general'],
    effect: 'read',
    trust: 'document',
    maxOutputChars: 16_000,
    displayNameKey: 'chat.toolName.getReviewChunk',
    requires: ['project'],
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
    requires: ['web-enabled'],
  },
  {
    name: 'confluence_search',
    profiles: ['general'],
    effect: 'external-read',
    trust: 'external',
    // 결과 건수·발췌는 도구가 먼저 줄인다(SEARCH_RESULT_LIMIT). 이 캡은 응답 형태가
    // 바뀌어 원문을 그대로 흘릴 때의 상한이다.
    maxOutputChars: 4_000,
    displayNameKey: 'chat.toolName.confluenceSearch',
    requires: ['confluence-enabled'],
  },
  {
    name: 'confluence_get_page',
    profiles: ['general'],
    effect: 'external-read',
    trust: 'external',
    // 위키 페이지 본문. 문서 조회(8,000)와 같은 상한을 쓴다.
    maxOutputChars: 8_000,
    displayNameKey: 'chat.toolName.confluenceGetPage',
    requires: ['confluence-enabled'],
  },
  {
    name: 'confluence_load_page',
    profiles: ['general'],
    effect: 'document-write',
    trust: 'external',
    maxOutputChars: 2_000,
    displayNameKey: 'chat.toolName.confluenceLoadPage',
    requires: ['confluence-enabled'],
  },
] as const;

const BY_NAME = new Map(CHAT_TOOL_REGISTRY.map((descriptor) => [descriptor.name, descriptor]));

export function getChatToolDescriptor(name: string): ChatToolDescriptor | undefined {
  return BY_NAME.get(name);
}

export function getChatToolDisplayNameKey(name: string): string | undefined {
  return getChatToolDescriptor(name)?.displayNameKey;
}
