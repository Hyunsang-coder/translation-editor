import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '@/stores/chatStore';

/**
 * Phase 7: 채팅 기본 기능 테스트
 * 사용자 스토리: 마리아가 메시지를 입력하고 AI 응답을 받음
 */

describe('ChatStore - 채팅 기본 기능 (Phase 7)', () => {
  beforeEach(() => {
    // 각 테스트 전 스토어 초기화
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      currentSession: null,
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
    // 🔴 Red: AI 응답 테스트 (스트리밍 콜백)

    it.skip('메시지 송신 후 AI 응답 스트리밍', async () => {
      // Arrange: 세션 생성
      // useChatStore.getState().createSession(...)
      // const sessionId = ...

      // Act: 메시지 전송 (실제로는 sendMessage 호출)
      // await useChatStore.getState().sendMessage({
      //   sessionId,
      //   message: 'What is API?',
      //   onToken: vi.fn(),
      // });

      // Assert: AI 응답이 세션에 추가됨
      // const session = useChatStore.getState().sessions[sessionId];
      // const lastMessage = session?.messages[session.messages.length - 1];
      // expect(lastMessage?.role).toBe('assistant');
      // expect(lastMessage?.content).toBeDefined();
    });

    it.skip('Confluence 검색 도구 자동 호출 (Phase 7.3)', async () => {
      // 사용자: "Confluence에서 찾아줘"
      // → AI가 도구 호출
      // → 검색 결과 반환
      // → 대화에 포함
    });

    it.skip('Notion 도구 호출 (Phase 7.4)', async () => {
      // 사용자: "용어집에서 확인해줘"
      // → AI가 Notion 도구 호출
      // → 용어 정의 반환
    });
  });
});
