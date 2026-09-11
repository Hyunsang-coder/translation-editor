/**
 * 인라인 서식 유지 프롬프트 테스트 (Red → Green).
 *
 * 모델 입력(currentTargetText)에는 `serializeInlineMarks`로 살린 서식이
 * 들어가고, 시스템 지시는 그 서식을 교체문에 유지하도록 해야 한다.
 * F9 교훈: 블록 라벨 언급 없이 인라인 mark만 다룬다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  polishSelection,
  polishSegments,
  retranslateSelection,
  retranslateSegments,
} from './retranslateSelection';

const streamMock = vi.fn();
const isTauriRuntimeMock = vi.fn(() => false);

vi.mock('@/tauri/invoke', () => ({
  isTauriRuntime: () => isTauriRuntimeMock(),
}));

vi.mock('@/ai/backendCompletion', () => ({
  streamWithTauriAiBackend: () => {
    throw new Error('backend not used in this test');
  },
}));

vi.mock('@/ai/config', () => ({
  getAiConfig: () => ({
    provider: 'openai',
    openaiApiKey: 'test-key',
    model: 'gpt-5-mini',
  }),
}));

vi.mock('@/ai/client', () => ({
  createChatModel: () => ({ stream: streamMock }),
}));

const BASE = {
  projectId: 'project-1',
  targetLanguage: 'Korean',
  referenceOptions: {
    translationRules: false,
    forbiddenTerms: false,
    glossary: false,
    projectMemory: false,
  },
  contextSnapshot: {
    revision: 1,
    projectMemoryItems: [],
    translationRules: '',
    forbiddenTerms: [],
    glossaryEntries: [],
    createdAt: 1,
  },
};

function payload(): string {
  const messages = streamMock.mock.calls[0]?.[0] as Array<{ content: string }>;
  return messages.map((message) => message.content).join('\n');
}

describe('인라인 서식 유지 지시', () => {
  beforeEach(() => {
    streamMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
  });

  it('polishSelection 시스템이 서식 유지 지시를 담는다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SELECTION_EDIT_START---\n다듬은 **번역**\n---SELECTION_EDIT_END---' };
    })());
    const result = await polishSelection({ ...BASE, currentTargetText: '현재 **번역**' });
    expect(payload()).toContain('**bold**');
    expect(payload()).toContain('현재 **번역**');
    expect(result.replacementText).toBe('다듬은 **번역**');
  });

  it('retranslateSelection 시스템이 서식 유지 지시를 담는다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---ALIGNED_SOURCE_SELECTION_START---\nSelected source\n---ALIGNED_SOURCE_SELECTION_END---\n---SELECTION_EDIT_START---\n개선된 **번역**\n---SELECTION_EDIT_END---' };
    })());
    await retranslateSelection({
      ...BASE,
      sourceText: 'Selected source',
      currentTargetText: '현재 **번역**',
    });
    expect(payload()).toContain('**bold**');
  });

  it('polishSegments 시스템이 서식 유지 지시를 담고 plain-text 줄에 인라인 mark를 허용한다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\n알파 **개선**\n---SEGMENT_0_END---' };
    })());
    const result = await polishSegments({
      ...BASE,
      segments: [{ currentTargetText: '알파 **번역**' }],
    });
    const text = payload();
    expect(text).toContain('**bold**');
    expect(text).toContain('알파 **번역**');
    expect(result.replacements).toEqual(['알파 **개선**']);
  });

  it('retranslateSegments 시스템이 서식 유지 지시를 담는다', async () => {
    streamMock.mockResolvedValue((async function* () {
      yield { content: '---SEGMENT_0_START---\n알파 **개선**\n---SEGMENT_0_END---' };
    })());
    await retranslateSegments({
      ...BASE,
      segments: [{ sourceText: 'Alpha source', currentTargetText: '알파 **번역**' }],
    });
    expect(payload()).toContain('**bold**');
  });
});
