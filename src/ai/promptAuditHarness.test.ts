import { describe, expect, it, vi } from 'vitest';
import type { ITEProject, ResolvedWorkflowContext } from '@/types';
import type { TipTapDocJson } from '@/utils/markdownConverter';
import { buildReviewPrompt } from '@/ai/tools/reviewTool';
import { buildLangChainMessages } from '@/ai/prompt';
import { buildToolGuideMessage } from '@/ai/chat';
import {
  PROMPT_AUDIT_MIN_SCORE,
  scorePromptAuditSurface,
} from '@/ai/promptAuditHarness';
import { FORBIDDEN_OVERRIDES_GLOSSARY_KO } from '@/ai/context/projectKnowledgeRender';

const capture = vi.hoisted(() => ({
  messages: [] as Array<{ role?: string; content?: string }>,
}));

vi.mock('@/ai/config', () => ({
  getAiConfig: vi.fn(() => ({
    provider: 'openai',
    model: 'gpt-5.6-sol',
    openaiApiKey: 'test-key',
    maxRecentMessages: 20,
  })),
}));

vi.mock('@/ai/client', () => ({
  createChatModel: vi.fn(() => ({
    stream: vi.fn(async function* (messages: Array<{ role?: string; content?: string }>) {
      capture.messages = messages;
      yield {
        content: '---TRANSLATION_START---\nAPI Integration Guide\n---TRANSLATION_END---',
      };
    }),
  })),
}));

import { translateWithStreaming } from '@/ai/translateDocument';

const project = {
  id: 'prompt-audit',
  version: '1.0.0',
  metadata: {
    title: 'Prompt audit',
    domain: 'general',
    sourceLanguage: '한국어',
    targetLanguage: '영어',
    createdAt: 1,
    updatedAt: 1,
    settings: {
      strictnessLevel: 0.5,
      autoSave: true,
      autoSaveInterval: 30_000,
      theme: 'system',
    },
  },
  segments: [],
  blocks: {},
} as ITEProject;

const sourceDocJson: TipTapDocJson = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'API 통합 가이드' }] }],
};

const resolvedContext: ResolvedWorkflowContext = {
  snapshot: {
    revision: 1,
    projectMemoryItems: [{ id: 'm1', category: 'audience', content: 'Developers' }],
    translationRules: 'Use concise documentation style.',
    forbiddenTerms: [{ id: 'f1', term: 'simply', replacement: 'directly' }],
    glossaryEntries: [{ id: 'g1', source: 'API', target: 'API' }],
    createdAt: 1,
  },
  manifest: {
    mode: 'full-translate',
    revision: 1,
    projectMemoryItemIds: ['m1'],
    forbiddenTermIds: ['f1'],
    glossaryEntryIds: ['g1'],
    included: ['project-memory', 'translation-rules', 'forbidden-terms', 'glossary'],
  },
  rendered: {
    projectMemory: '- [audience] Developers',
    translationRules: 'Use concise documentation style.',
    forbiddenTerms: '- simply → directly',
    glossary: 'API = API',
  },
};

describe('prompt audit score harness', () => {
  it('채팅 경유 검수 계약 점수가 80점 이상이다', () => {
    const prompt = buildReviewPrompt({
      output: 'chat',
      explanationLanguage: '한국어',
      partialContext: true,
    });
    const result = scorePromptAuditSurface('chat-review', {
      system: prompt,
      user: '',
    });
    console.table(result.checks);
    console.log(`[prompt-audit] ${result.surface}: ${result.score}/100`);
    expect(result.score).toBeGreaterThanOrEqual(PROMPT_AUDIT_MIN_SCORE);
  });

  it('채팅 system + 선택 도구 가이드 점수가 80점 이상이다', async () => {
    const messages = await buildLangChainMessages({
      project,
      contextBlocks: [],
      recentMessages: [],
      userMessage: '선택한 번역을 검토해줘.',
      selection: {
        selectionId: 's1',
        selectionScopeId: 'scope1',
        projectId: project.id,
        panel: 'target',
        text: 'API Integration Guide',
        translationUnitIds: [],
        documentRevision: '1',
        anchorStatusAtSend: 'active',
      },
      translationRules: 'Use concise documentation style.',
      forbiddenTermsDigest: '- simply → directly',
      forbiddenTermsTruncated: true,
      glossaryInjected: 'API = API',
    }, { requestType: 'question' });
    const guide = String(buildToolGuideMessage({
      profile: 'selection-target',
      boundToolNames: [
        'get_source_document',
        'get_target_document',
        'get_selection_surroundings',
        'get_aligned_selection_context',
      ],
    }).content);
    const result = scorePromptAuditSurface('chat', {
      system: `${String(messages[0]!.content)}\n${guide}`,
      user: String(messages.at(-1)!.content),
    });
    console.table(result.checks);
    console.log(`[prompt-audit] ${result.surface}: ${result.score}/100`);
    expect(String(messages[0]!.content)).toContain(FORBIDDEN_OVERRIDES_GLOSSARY_KO);
    expect(result.score).toBeGreaterThanOrEqual(PROMPT_AUDIT_MIN_SCORE);
  });

  it('전체 번역 계약 점수가 80점 이상이다', async () => {
    await translateWithStreaming({
      project,
      sourceDocJson,
      resolvedContext,
      retranslateMessage: 'Use a more direct tone.',
      userComments: '[사용자 코멘트]\n1. "가이드" — Keep this concise.',
    });
    const result = scorePromptAuditSurface('full-translation', {
      system: String(capture.messages[0]?.content ?? ''),
      user: String(capture.messages[1]?.content ?? ''),
    });
    console.table(result.checks);
    console.log(`[prompt-audit] ${result.surface}: ${result.score}/100`);
    expect(result.score).toBeGreaterThanOrEqual(PROMPT_AUDIT_MIN_SCORE);
  });
});
