import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TipTapDocJson } from '@/utils/markdownConverter';
import { polishTargetDocumentWithStreaming } from '@/ai/polishDocument';
import { createMockAiConfig } from '@/test/mocks/ai';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
}));

vi.mock('@/ai/config', () => ({
  getAiConfig: vi.fn(() => createMockAiConfig()),
}));

vi.mock('@/ai/client', () => ({
  createChatModel: vi.fn(() => ({
    stream: mocks.stream,
  })),
}));

describe('polishTargetDocumentWithStreaming', () => {
  const targetDocJson: TipTapDocJson = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'This sentence has awkward collocation.' }],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAiConfig).mockReturnValue(createMockAiConfig());
    mocks.stream.mockImplementation(async function* () {
      yield { content: '---POLISH_START---\n' };
      yield { content: 'This sentence uses a more natural collocation.\n' };
      yield { content: '---POLISH_END---' };
    });
  });

  it('번역문만 폴리싱하고 검수 이슈 포맷을 사용하지 않는다', async () => {
    const result = await polishTargetDocumentWithStreaming({
      targetDocJson,
      targetLanguage: 'English',
      styleRules: 'Keep concise.',
    });

    expect(result.raw).toContain('---POLISH_START---');
    expect(result.doc.type).toBe('doc');
    expect(vi.mocked(createChatModel)).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ useFor: 'translation' }),
    );

    const [messages] = mocks.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
    const systemPrompt = String(messages[0]?.content);
    const userPrompt = String(messages[1]?.content);

    expect(systemPrompt).toContain('native English editor');
    expect(systemPrompt).toContain('Return the complete polished Markdown');
    expect(systemPrompt).not.toContain('Issue #1');
    expect(systemPrompt).not.toContain('Severity');
    expect(userPrompt).toContain('---TARGET_DOCUMENT_START---');
    expect(userPrompt).toContain('This sentence has awkward collocation.');
    expect(userPrompt).not.toContain('Source (');
  });

  it('사용자 추가 지시사항을 폴리싱 프롬프트에 포함한다', async () => {
    await polishTargetDocumentWithStreaming({
      targetDocJson,
      polishMessage: 'Make the tone more formal without changing product terminology.',
    });

    const [messages] = mocks.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
    const systemPrompt = String(messages[0]?.content);

    expect(systemPrompt).toContain('Additional user instructions for this polishing run:');
    expect(systemPrompt).toContain('Make the tone more formal without changing product terminology.');
  });

  it('프로젝트 컨텍스트와 페르소나를 폴리싱 프롬프트에 포함한다', async () => {
    await polishTargetDocumentWithStreaming({
      targetDocJson,
      styleRules: 'Keep product names untranslated.',
      projectContext: 'PUBG patch notes for competitive players.',
      translatorPersona: 'Concise game localization editor.',
    });

    const [messages] = mocks.stream.mock.calls[0] as [Array<{ content?: string }>, unknown];
    const systemPrompt = String(messages[0]?.content);

    expect(systemPrompt).toContain('Style/translation rules to respect:');
    expect(systemPrompt).toContain('Keep product names untranslated.');
    expect(systemPrompt).toContain('[Project Context]');
    expect(systemPrompt).toContain('PUBG patch notes for competitive players.');
    expect(systemPrompt).toContain('Tone reference (stylistic guidance only; do not invent or drop meaning):');
    expect(systemPrompt).toContain('Concise game localization editor.');
  });

  it('취소 신호가 이미 있으면 호출하지 않는다', async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      polishTargetDocumentWithStreaming({
        targetDocJson,
        abortSignal: abortController.signal,
      }),
    ).rejects.toThrow('폴리싱이 취소되었습니다.');

    expect(mocks.stream).not.toHaveBeenCalled();
  });
});
