/**
 * chatStore 영속성 로직 (debounce, persist, hydrate request tracking)
 *
 * Module-level state는 의도적입니다: debounce 타이머를 Zustand에 저장하면
 * 타이머 변경마다 리렌더링이 발생하므로 모듈 스코프에 유지합니다.
 */
import { isTauriRuntime } from '@/tauri/invoke';
import {
  saveChatSessions,
  saveChatProjectSettings,
  type ChatProjectSettings,
} from '@/tauri/chat';
import { CHAT_PERSIST_DEBOUNCE_MS, MAX_CHAT_SESSIONS } from './chatStore.types';
import type { ChatGet } from './chatStore.types';

// ── Module-Level State ─────────────────────────────────────────────────

let chatPersistTimer: number | null = null;
let chatPersistInFlight = false;
let chatPersistQueued = false;
let hydrateRequestId = 0;
// Issue #9 Fix: 타이머 스케줄 시점의 프로젝트 ID를 캡처하여 persist 시 재검증
let scheduledPersistProjectId: string | null = null;

// ── Hydrate Request ID ─────────────────────────────────────────────────

export function getHydrateRequestId(): number {
  return hydrateRequestId;
}

export function incrementHydrateRequestId(): number {
  return ++hydrateRequestId;
}

// ── Persist Timer Access (for hydrateForProject flush) ─────────────────

export function clearPersistTimer(): void {
  if (chatPersistTimer !== null) {
    window.clearTimeout(chatPersistTimer);
    chatPersistTimer = null;
    // Issue #9 Fix: 타이머 취소 시 캡처된 프로젝트 ID도 정리
    scheduledPersistProjectId = null;
  }
}

// ── Persist Helpers Creator ────────────────────────────────────────────

export function createPersistHelpers(get: ChatGet) {
  const buildChatSettings = (): ChatProjectSettings => ({
    // 레거시 필드: 항상 빈 문자열로 저장해 이전 persona 값을 지운다.
    translatorPersona: '',
    translationRules: get().translationRules,
    projectContext: get().projectContext,
    composerText: get().composerText,
    webSearchEnabled: get().webSearchEnabled,
    translationContextSessionId: get().translationContextSessionId,
  });

  const persistNow = async (): Promise<void> => {
    if (!isTauriRuntime()) return;
    if (get().isHydrating) return; // 로드 중에는 저장하지 않음 (데이터 유실 방지)

    // getActiveProjectId() 대신 현재 스토어에 로드된 ID 사용
    const projectId = get().loadedProjectId;
    if (!projectId) return;

    const session = get().currentSession;
    const settings = buildChatSettings();

    // 세션은 최대 5개만 저장
    // - 저장은 전체 sessions를 대상으로 하되, 백엔드에서도 최종적으로 5개로 clamp됩니다.
    const sessions = get().sessions.slice(0, MAX_CHAT_SESSIONS);
    if (sessions.length > 0) {
      await saveChatSessions({ projectId, sessions });
    } else if (session) {
      // 안전장치: sessions가 비어있지만 currentSession이 있으면 1개만 저장
      await saveChatSessions({ projectId, sessions: [session] });
    }
    await saveChatProjectSettings({ projectId, settings });
  };

  const schedulePersist = (): void => {
    if (!isTauriRuntime()) return;
    if (chatPersistTimer !== null) {
      window.clearTimeout(chatPersistTimer);
      chatPersistTimer = null;
    }
    // Issue #9 Fix: 스케줄 시점의 프로젝트 ID 캡처
    scheduledPersistProjectId = get().loadedProjectId;
    chatPersistTimer = window.setTimeout(() => {
      // Issue #9 Fix: persist 실행 전 프로젝트 ID 재검증
      const currentProjectId = get().loadedProjectId;
      if (scheduledPersistProjectId !== currentProjectId) {
        console.warn(`[chatStore] schedulePersist skipped: project changed from ${scheduledPersistProjectId} to ${currentProjectId}`);
        scheduledPersistProjectId = null;
        return;
      }
      if (chatPersistInFlight) {
        chatPersistQueued = true;
        return;
      }
      chatPersistInFlight = true;
      void persistNow()
        .catch(() => {
          // chat persistence는 UX 방해 최소화: 실패는 조용히 처리
        })
        .finally(() => {
          chatPersistInFlight = false;
          scheduledPersistProjectId = null;
          if (chatPersistQueued) {
            chatPersistQueued = false;
            schedulePersist();
          }
        });
    }, CHAT_PERSIST_DEBOUNCE_MS);
  };

  return { buildChatSettings, persistNow, schedulePersist };
}
