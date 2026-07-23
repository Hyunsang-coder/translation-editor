import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from '@/stores/chatStore';
import { useConnectorStore } from '@/stores/connectorStore';

const mocks = vi.hoisted(() => ({
  streamAssistantReply: vi.fn(),
  getAiConfig: vi.fn(),
  resolveModelRunConfig: vi.fn(),
  createChatModel: vi.fn(),
  searchGlossary: vi.fn(),
  webInvoke: vi.fn(),
  attachFile: vi.fn(),
  deleteAttachment: vi.fn(),
  listAttachments: vi.fn(),
  previewAttachment: vi.fn(),
  readImageAsDataUrl: vi.fn(),
}));

vi.mock('@/ai/chat', () => ({
  streamAssistantReply: mocks.streamAssistantReply,
}));

vi.mock('@/ai/config', () => ({
  getAiConfig: mocks.getAiConfig,
  resolveModelRunConfig: mocks.resolveModelRunConfig,
}));

vi.mock('@/ai/client', () => ({
  createChatModel: mocks.createChatModel,
}));

vi.mock('@/tauri/glossary', () => ({
  searchGlossary: mocks.searchGlossary,
}));

vi.mock('@/tauri/attachments', () => ({
  attachFile: mocks.attachFile,
  deleteAttachment: mocks.deleteAttachment,
  listAttachments: mocks.listAttachments,
  previewAttachment: mocks.previewAttachment,
  readImageAsDataUrl: mocks.readImageAsDataUrl,
}));

/**
 * Phase 7: 채팅 기본 기능 테스트
 * 사용자 스토리: 마리아가 메시지를 입력하고 AI 응답을 받음
 */

describe('ChatStore - 채팅 기본 기능 (Phase 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.searchGlossary.mockResolvedValue([]);
    mocks.getAiConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      maxRecentMessages: 20,
      openaiApiKey: 'sk-test',
    });
    mocks.resolveModelRunConfig.mockReturnValue({
      requestedPreset: 'gpt-5.6-luna-medium',
      resolvedModel: 'gpt-5.6-luna',
      provider: 'openai',
      reasoningEffort: 'medium',
      maxRecentMessages: 20,
      openaiApiKey: 'sk-test',
    });
    mocks.streamAssistantReply.mockImplementation(async (_input, _runConfig, callbacks) => {
      callbacks?.onToken?.('AI 응답입니다.', 'AI 응답입니다.');
      return 'AI 응답입니다.';
    });
    mocks.webInvoke.mockResolvedValue({
      content: '웹 검색 결과',
    });
    mocks.createChatModel.mockReturnValue({
      invoke: mocks.webInvoke,
      bindTools: vi.fn().mockReturnThis(),
    });

    const connectorState = useConnectorStore.getState();
    useConnectorStore.setState({
      enabledMap: {
        ...connectorState.enabledMap,
        notion: false,
      },
      tokenMap: {
        ...connectorState.tokenMap,
        notion: false,
      },
    });

    // 각 테스트 전 스토어 초기화
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      currentSession: null,
      isLoading: false,
      isAttachmentLoading: false,
      isFinalizingStreaming: false,
      streamingMessageId: null,
      streamingSessionId: null,
      streamingContent: null,
      streamingMetadata: null,
      error: null,
      statusMessage: null,
      abortController: null,
      composerAttachments: [],
      attachments: [],
      loadedProjectId: null,
      webSearchEnabled: true,
    });
  });

  describe('메시지 입력/전송 기본 (Phase 7.1)', () => {
    it('새 세션 생성 가능', () => {
      // Act: 세션 생성
      useChatStore.getState().createSession('API Documentation');

      // Assert: 세션 생성됨
      const state = useChatStore.getState();
      expect(state.sessions.length).toBeGreaterThan(0);
      expect(state.currentSessionId).toBeDefined();
    });

    it('세션 내에 메시지 추가 가능', () => {
      // Arrange: 세션 생성
      useChatStore.getState().createSession('API Documentation');
      const sessionId = useChatStore.getState().currentSessionId!;

      // Act: 메시지 추가
      useChatStore.getState().addMessage(
        {
          role: 'user',
          content: 'What is the difference between API endpoint and API URL?',
        },
        sessionId
      );

      // Assert: 메시지 저장됨
      const session = useChatStore.getState().sessions.find((s) => s.id === sessionId);
      expect(session?.messages.length).toBeGreaterThan(0);
      expect(session?.messages[0]?.role).toBe('user');
    });

    it('메시지 업데이트 가능 (스트리밍)', () => {
      // Arrange: 세션 + 메시지
      useChatStore.getState().createSession('Chat');
      const sessionId = useChatStore.getState().currentSessionId!;

      useChatStore.getState().addMessage(
        {
          role: 'assistant',
          content: '',
        },
        sessionId
      );

      // Act: 메시지 업데이트 (스트리밍)
      const messageId = useChatStore.getState().sessions.find((s) => s.id === sessionId)?.messages[0]?.id;
      useChatStore.getState().updateMessage(
        messageId!,
        { content: 'Great question! ' },
        sessionId
      );

      // Assert: 메시지 업데이트됨
      const message = useChatStore
        .getState()
        .sessions.find((s) => s.id === sessionId)?.messages.find((m) => m.id === messageId);
      expect(message?.content).toContain('Great question');
    });

    it('메시지 삭제 가능', () => {
      // Arrange: 세션 + 메시지 2개
      useChatStore.getState().createSession('Chat');
      const sessionId = useChatStore.getState().currentSessionId!;

      useChatStore.getState().addMessage(
        {
          role: 'user',
          content: 'Message 1',
        },
        sessionId
      );
      useChatStore.getState().addMessage(
        {
          role: 'assistant',
          content: 'Response 1',
        },
        sessionId
      );

      const initialCount = useChatStore.getState().sessions.find((s) => s.id === sessionId)?.messages.length || 0;

      // Act: 메시지 삭제
      const messageId = useChatStore.getState().sessions.find((s) => s.id === sessionId)?.messages[0]?.id;
      useChatStore.getState().deleteMessageFrom(
        messageId!,
        sessionId
      );

      // Assert: 메시지 삭제됨
      const finalCount = useChatStore.getState().sessions.find((s) => s.id === sessionId)?.messages.length || 0;
      expect(finalCount).toBeLessThan(initialCount);
    });
  });

  describe('세션 관리 (Phase 7 - Session Switching)', () => {
    it('여러 세션 독립적으로 관리', () => {
      // Act: 세션 1 생성 + 메시지
      useChatStore.getState().createSession('Session 1');
      const session1Id = useChatStore.getState().currentSessionId!;
      useChatStore.getState().addMessage(
        {
          role: 'user',
          content: 'Session 1 message',
        },
        session1Id
      );

      // Act: 세션 2 생성 + 메시지
      useChatStore.getState().createSession('Session 2');
      const session2Id = useChatStore.getState().currentSessionId!;
      useChatStore.getState().addMessage(
        {
          role: 'user',
          content: 'Session 2 message',
        },
        session2Id
      );

      // Assert: 두 세션 독립적
      expect(session1Id).not.toBe(session2Id);
      expect(useChatStore.getState().sessions.find((s) => s.id === session1Id)?.messages).toHaveLength(1);
      expect(useChatStore.getState().sessions.find((s) => s.id === session2Id)?.messages).toHaveLength(1);
    });

    it('세션 전환 가능', () => {
      // Arrange: 세션 2개
      useChatStore.getState().createSession('Session 1');
      const session1Id = useChatStore.getState().currentSessionId!;

      useChatStore.getState().createSession('Session 2');

      // Act: Session 1로 전환
      useChatStore.getState().switchSession(session1Id);

      // Assert: 현재 세션 변경됨
      expect(useChatStore.getState().currentSessionId).toBe(session1Id);
    });
  });

  describe('메시지 히스토리 (Phase 7 - Chat History)', () => {
    it('멀티턴 대화 유지', () => {
      // Arrange: 세션 생성
      useChatStore.getState().createSession('Chat');
      const sessionId = useChatStore.getState().currentSessionId!;

      // Act: 다중 턴 대화
      const turns = [
        { role: 'user' as const, content: 'Turn 1 User' },
        { role: 'assistant' as const, content: 'Turn 1 Assistant' },
        { role: 'user' as const, content: 'Turn 2 User' },
        { role: 'assistant' as const, content: 'Turn 2 Assistant' },
      ];

      for (const turn of turns) {
        useChatStore.getState().addMessage(
          {
            role: turn.role,
            content: turn.content,
          },
          sessionId
        );
      }

      // Assert: 모든 메시지 유지
      const messages = useChatStore.getState().sessions.find((s) => s.id === sessionId)?.messages || [];
      expect(messages).toHaveLength(4);
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    });
  });

  describe('AI 응답 스트리밍 (Phase 7.2)', () => {
    it('메시지 송신 후 AI 응답 스트리밍', async () => {
      // Arrange: 세션 생성
      useChatStore.getState().createSession('Chat');
      const sessionId = useChatStore.getState().currentSessionId!;

      // Act: 메시지 전송
      await useChatStore.getState().sendMessage('What is API endpoint?', sessionId);

      // Assert: 사용자/어시스턴트 메시지가 순서대로 저장되고 스트리밍이 finalize됨
      const session = useChatStore.getState().sessions.find((s) => s.id === sessionId);
      expect(session?.messages).toHaveLength(2);
      expect(session?.messages[0]?.role).toBe('user');
      expect(session?.messages[1]?.role).toBe('assistant');
      expect(session?.messages[1]?.content).toBe('AI 응답입니다.');
      expect(useChatStore.getState().isLoading).toBe(false);
      expect(useChatStore.getState().streamingMessageId).toBeNull();
      expect(mocks.streamAssistantReply).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: 'What is API endpoint?',
          confluenceSearchEnabled: true,
          notionSearchEnabled: false,
        }),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('assistant 메시지 메타데이터가 캡처된 runConfig(요청 프리셋/실제 모델/provider)와 일치', async () => {
      // Arrange
      useChatStore.getState().createSession('Meta Chat');
      const sessionId = useChatStore.getState().currentSessionId!;

      // 준비 이후 전역 모델이 바뀌어도 기록 메타는 캡처 시점 값을 유지해야 함
      mocks.streamAssistantReply.mockImplementationOnce(async (_input, _runConfig, callbacks) => {
        callbacks?.onUsage?.({ inputTokens: 120, outputTokens: 45, totalTokens: 165 });
        callbacks?.onToken?.('응답', '응답');
        return '응답';
      });

      // Act
      await useChatStore.getState().sendMessage('모델 출처 확인', sessionId);

      // Assert: 실제 호출에 쓰인 runConfig(mock)가 메시지 메타데이터로 기록됨
      const session = useChatStore.getState().sessions.find((s) => s.id === sessionId);
      const assistant = session?.messages.find((m) => m.role === 'assistant');
      expect(assistant?.metadata?.requestedModelPreset).toBe('gpt-5.6-luna-medium');
      expect(assistant?.metadata?.resolvedModel).toBe('gpt-5.6-luna');
      expect(assistant?.metadata?.provider).toBe('openai');
      // usage_metadata가 finalize 후에도 보존됨
      expect(assistant?.metadata?.inputTokens).toBe(120);
      expect(assistant?.metadata?.outputTokens).toBe(45);
      expect(assistant?.metadata?.totalTokens).toBe(165);
    });

    it('Confluence 검색 활성 여부가 AI 요청 옵션에 반영됨', async () => {
      // Arrange
      useChatStore.getState().createSession('Confluence Session');
      const sessionId = useChatStore.getState().currentSessionId!;
      useChatStore.getState().setConfluenceSearchEnabled(false, sessionId);

      // Act
      await useChatStore.getState().sendMessage('Confluence에서 API 문서를 찾아줘', sessionId);

      // Assert: 세션 설정이 모델 요청에 반영됨
      expect(mocks.streamAssistantReply).toHaveBeenCalledWith(
        expect.objectContaining({
          confluenceSearchEnabled: false,
        }),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('Notion 토큰/활성 상태에 따라 도구 사용 가능 여부가 반영됨', async () => {
      // Arrange
      useConnectorStore.setState((state) => ({
        enabledMap: {
          ...state.enabledMap,
          notion: true,
        },
        tokenMap: {
          ...state.tokenMap,
          notion: true,
        },
      }));
      useChatStore.getState().createSession('Notion Session');
      const sessionId = useChatStore.getState().currentSessionId!;

      // Act
      await useChatStore.getState().sendMessage('용어집에서 endpoint 정의를 확인해줘', sessionId);

      // Assert
      expect(mocks.streamAssistantReply).toHaveBeenCalledWith(
        expect.objectContaining({
          notionSearchEnabled: true,
        }),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('L1: 스트림 완료 경로 소유권(epoch) 가드', () => {
    it('취소 후 늦게 resolve된 요청 A가 새 요청 B의 스트리밍 상태를 덮지 않음', async () => {
      // Arrange: 세션 + 지연 resolve 가능한 스트림 2개
      useChatStore.getState().createSession('Chat');
      const sessionId = useChatStore.getState().currentSessionId!;

      let resolveA!: (value: string) => void;
      let resolveB!: (value: string) => void;
      mocks.streamAssistantReply
        .mockImplementationOnce(() => new Promise<string>((res) => { resolveA = res; }))
        .mockImplementationOnce(() => new Promise<string>((res) => { resolveB = res; }));

      // Act 1: 요청 A 시작
      const promiseA = useChatStore.getState().sendMessage('A 질문', sessionId);
      await vi.waitFor(() => {
        expect(useChatStore.getState().streamingMessageId).not.toBeNull();
      });
      const userMessageA = useChatStore
        .getState()
        .sessions.find((s) => s.id === sessionId)!
        .messages.find((m) => m.role === 'user')!;

      // Act 2: A 취소 (deleteMessageFrom = 실제 취소 트리거와 동일 경로)
      useChatStore.getState().deleteMessageFrom(userMessageA.id, sessionId);
      expect(useChatStore.getState().abortController).toBeNull();

      // Act 3: 새 요청 B 시작
      const promiseB = useChatStore.getState().sendMessage('B 질문', sessionId);
      await vi.waitFor(() => {
        expect(useChatStore.getState().streamingMessageId).not.toBeNull();
      });
      const bPlaceholderId = useChatStore.getState().streamingMessageId!;
      const bController = useChatStore.getState().abortController;
      expect(bController).not.toBeNull();

      // Act 4: A가 뒤늦게 정상 resolve (마지막 청크 후 abort된 시나리오)
      resolveA('A 응답');
      await promiseA;

      // Assert: A의 후속 코드가 B의 진행 상태를 파괴하지 않음
      const stateAfterA = useChatStore.getState();
      expect(stateAfterA.streamingMessageId).toBe(bPlaceholderId);
      expect(stateAfterA.abortController).toBe(bController);
      expect(stateAfterA.isLoading).toBe(true);
      const bPlaceholderAfterA = stateAfterA.sessions
        .find((s) => s.id === sessionId)!
        .messages.find((m) => m.id === bPlaceholderId)!;
      expect(bPlaceholderAfterA.content).toBe(''); // A의 내용이 B placeholder에 커밋되지 않음

      // Act 5: B 정상 완료
      resolveB('B 응답');
      await promiseB;

      // Assert: B의 응답만 커밋되고 A의 응답은 어디에도 없음
      const session = useChatStore.getState().sessions.find((s) => s.id === sessionId)!;
      const bMessage = session.messages.find((m) => m.id === bPlaceholderId)!;
      expect(bMessage.content).toBe('B 응답');
      expect(session.messages.some((m) => m.content === 'A 응답')).toBe(false);
      expect(useChatStore.getState().isLoading).toBe(false);
      expect(useChatStore.getState().abortController).toBeNull();
    });

    it('abort된 요청의 빈 assistant placeholder가 제거됨 (L5)', async () => {
      // Arrange: abort 시 AbortError로 reject되는 스트림
      useChatStore.getState().createSession('Chat');
      const sessionId = useChatStore.getState().currentSessionId!;

      mocks.streamAssistantReply.mockImplementationOnce(
        (input: { abortSignal?: AbortSignal }) =>
          new Promise<string>((_res, reject) => {
            input.abortSignal?.addEventListener('abort', () => {
              reject(new DOMException('Request aborted', 'AbortError'));
            });
          }),
      );

      // Act: 전송 후 abort
      const promise = useChatStore.getState().sendMessage('안녕하세요', sessionId);
      await vi.waitFor(() => {
        expect(useChatStore.getState().streamingMessageId).not.toBeNull();
      });
      useChatStore.getState().abortController!.abort();
      await promise;

      // Assert: 빈 placeholder는 제거되고 사용자 메시지만 남음, 상태 리셋
      const session = useChatStore.getState().sessions.find((s) => s.id === sessionId)!;
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0]?.role).toBe('user');
      expect(useChatStore.getState().isLoading).toBe(false);
      expect(useChatStore.getState().streamingMessageId).toBeNull();
      expect(useChatStore.getState().abortController).toBeNull();
      expect(useChatStore.getState().error).toBeNull();
    });

    it('finalizeStreaming은 명시된 assistantId가 현재 스트리밍 메시지와 다르면 커밋하지 않음', () => {
      // Arrange: placeholder + 스트리밍 상태
      useChatStore.getState().createSession('Chat');
      const sessionId = useChatStore.getState().currentSessionId!;
      const placeholderId = useChatStore
        .getState()
        .addMessage({ role: 'assistant', content: '' }, sessionId)!;
      useChatStore.setState({
        streamingMessageId: placeholderId,
        streamingSessionId: sessionId,
        streamingContent: '스트리밍 내용',
        isLoading: true,
      });

      // Act 1: 다른 id로 finalize 시도 → 무시
      useChatStore.getState().finalizeStreaming('other-message-id');

      // Assert 1: 커밋되지 않고 스트리밍 상태 유지
      const sessionAfterMismatch = useChatStore.getState().sessions.find((s) => s.id === sessionId)!;
      expect(sessionAfterMismatch.messages.find((m) => m.id === placeholderId)?.content).toBe('');
      expect(useChatStore.getState().streamingMessageId).toBe(placeholderId);
      expect(useChatStore.getState().isLoading).toBe(true);

      // Act 2: 올바른 id로 finalize → 커밋
      useChatStore.getState().finalizeStreaming(placeholderId);

      // Assert 2
      const sessionAfterCommit = useChatStore.getState().sessions.find((s) => s.id === sessionId)!;
      expect(sessionAfterCommit.messages.find((m) => m.id === placeholderId)?.content).toBe('스트리밍 내용');
      expect(useChatStore.getState().streamingMessageId).toBeNull();
      expect(useChatStore.getState().isLoading).toBe(false);
    });
  });

  describe('L5: attachFile 프로젝트 전환 가드', () => {
    const attachmentDto = {
      id: 'att-1',
      filename: 'doc.pdf',
      fileType: 'pdf',
      fileSize: 100,
      extractedTextLength: 10,
      filePath: '/tmp/doc.pdf',
      createdAt: 0,
      updatedAt: 0,
    };

    it('첨부 처리 중 프로젝트가 전환되면 첨부 목록에 append하지 않음 (유령 첨부 방지)', async () => {
      useChatStore.setState({ loadedProjectId: 'project-a', attachments: [] });
      mocks.attachFile.mockImplementation(async () => {
        // 첨부 저장 중 프로젝트 전환 시뮬레이션
        useChatStore.setState({ loadedProjectId: 'project-b' });
        return attachmentDto;
      });

      await useChatStore.getState().attachFile('/tmp/doc.pdf');

      expect(useChatStore.getState().attachments).toHaveLength(0);
    });

    it('프로젝트가 유지되면 정상적으로 append', async () => {
      useChatStore.setState({ loadedProjectId: 'project-a', attachments: [] });
      mocks.attachFile.mockResolvedValue(attachmentDto);

      await useChatStore.getState().attachFile('/tmp/doc.pdf');

      expect(useChatStore.getState().attachments).toHaveLength(1);
      expect(useChatStore.getState().isAttachmentLoading).toBe(false);
    });
  });
});
