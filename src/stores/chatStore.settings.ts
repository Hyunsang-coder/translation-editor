/**
 * chatStore 설정/첨부/컴포저/컨텍스트블록/유틸리티 슬라이스
 */
import type { ChatSession } from '@/types';
import {
  attachFile,
  deleteAttachment as deleteAttachmentApi,
  listAttachments,
  previewAttachment,
  readImageAsDataUrl,
} from '@/tauri/attachments';
import { resizeImageForApi, IMAGE_SIZE_LIMITS } from '@/utils/imageResize';
import type { ChatSet, ChatGet, PendingComposerAppend } from './chatStore.types';

// ── Composer Actions ───────────────────────────────────────────────────

export function createComposerActions(
  set: ChatSet,
  get: ChatGet,
  helpers: { schedulePersist: () => void },
) {
  const { schedulePersist } = helpers;

  const setComposerText = (text: string): void => {
    set({ composerText: text });
    schedulePersist();
  };

  const appendComposerText = (text: string, opts?: { separator?: string }): void => {
    const incoming = text.trim();
    if (!incoming) return;
    set((state) => ({
      pendingComposerAppend: {
        text: incoming,
        separator: opts?.separator ?? '\n\n',
        targetSessionId: state.currentSessionId,
        nonce: (state.pendingComposerAppend?.nonce ?? 0) + 1,
      },
      pendingComposerFocus: {
        targetSessionId: state.currentSessionId,
        nonce: (state.pendingComposerFocus?.nonce ?? 0) + 1,
      },
      composerFocusNonce: state.composerFocusNonce + 1,
    }));
  };

  const consumePendingComposerAppend = (targetSessionId: string): PendingComposerAppend | null => {
    const pending = get().pendingComposerAppend;
    if (!pending) return null;
    if (pending.targetSessionId && pending.targetSessionId !== targetSessionId) return null;

    let consumed = false;
    set((state) => {
      if (state.pendingComposerAppend?.nonce !== pending.nonce) return {};
      consumed = true;
      return { pendingComposerAppend: null };
    });

    return consumed ? pending : null;
  };

  const requestComposerFocus = (targetSessionId?: string): void => {
    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    set((state) => ({
      pendingComposerFocus: {
        targetSessionId: resolvedSessionId ?? null,
        nonce: (state.pendingComposerFocus?.nonce ?? 0) + 1,
      },
      composerFocusNonce: state.composerFocusNonce + 1,
    }));
  };

  return {
    setComposerText,
    appendComposerText,
    consumePendingComposerAppend,
    requestComposerFocus,
  };
}

// ── Settings Actions ───────────────────────────────────────────────────

export function createSettingsActions(
  set: ChatSet,
  get: ChatGet,
  helpers: { schedulePersist: () => void },
) {
  const { schedulePersist } = helpers;

  /** 세미콜론 구분 스니펫을 불릿 포인트로 변환해 기존 필드에 추가 */
  const appendFormattedSnippet = (
    fieldName: 'translationRules' | 'projectContext',
    snippet: string,
  ): void => {
    const incoming = snippet.trim();
    if (!incoming) return;
    const formatted = incoming
      .split(';')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => `- ${r}`)
      .join('\n');
    const current = (get()[fieldName] as string).trim();
    const next = current.length > 0 ? `${current}\n\n${formatted}` : formatted;
    set({ [fieldName]: next });
    schedulePersist();
  };

  const setTranslationRules = (rules: string): void => {
    set({ translationRules: rules });
    schedulePersist();
  };

  const appendToTranslationRules = (snippet: string): void =>
    appendFormattedSnippet('translationRules', snippet);

  const setProjectContext = (memory: string): void => {
    set({ projectContext: memory });
    schedulePersist();
  };

  const appendToProjectContext = (snippet: string): void =>
    appendFormattedSnippet('projectContext', snippet);

  const setWebSearchEnabled = (enabled: boolean): void => {
    set({ webSearchEnabled: enabled });
    schedulePersist();
  };

  const setConfluenceSearchEnabled = (enabled: boolean, targetSessionId?: string): void => {
    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    if (!resolvedSessionId) return;

    const { currentSession, sessions } = get();
    const targetSession = sessions.find((s) => s.id === resolvedSessionId);
    if (!targetSession) return;

    const updated: ChatSession = { ...targetSession, confluenceSearchEnabled: enabled };
    set({
      currentSession: currentSession?.id === resolvedSessionId ? updated : currentSession,
      sessions: sessions.map((s) => (s.id === resolvedSessionId ? updated : s)),
    });
    schedulePersist();
  };

  const setTranslationContextSessionId = (sessionId: string | null): void => {
    set({ translationContextSessionId: sessionId });
    schedulePersist();
  };

  return {
    setTranslationRules,
    appendToTranslationRules,
    setProjectContext,
    appendToProjectContext,
    setWebSearchEnabled,
    setConfluenceSearchEnabled,
    setTranslationContextSessionId,
  };
}

// ── Context Block Actions ──────────────────────────────────────────────

export function createContextBlockActions(
  set: ChatSet,
  get: ChatGet,
  helpers: { schedulePersist: () => void },
) {
  const { schedulePersist } = helpers;

  const setContextBlocks = (blockIds: string[]): void => {
    const { currentSession, currentSessionId } = get();
    if (!currentSession || !currentSessionId) return;

    const updatedSession: ChatSession = {
      ...currentSession,
      contextBlockIds: blockIds,
    };

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === currentSessionId ? updatedSession : s
      ),
      currentSession: updatedSession,
    }));
    schedulePersist();
  };

  const addContextBlock = (blockId: string): void => {
    const { currentSession } = get();
    if (!currentSession) return;

    if (!currentSession.contextBlockIds.includes(blockId)) {
      get().setContextBlocks([...currentSession.contextBlockIds, blockId]);
    }
  };

  const removeContextBlock = (blockId: string): void => {
    const { currentSession } = get();
    if (!currentSession) return;

    get().setContextBlocks(
      currentSession.contextBlockIds.filter((id) => id !== blockId)
    );
  };

  return {
    setContextBlocks,
    addContextBlock,
    removeContextBlock,
  };
}

// ── Attachment Actions ─────────────────────────────────────────────────

export function createAttachmentActions(set: ChatSet, get: ChatGet) {
  const attachFileAction = async (path: string): Promise<void> => {
    const projectId = get().loadedProjectId;
    if (!projectId) return;

    set({ isAttachmentLoading: true });
    try {
      const newAtt = await attachFile(projectId, path);
      // L5: 첨부 처리 중 프로젝트가 전환됐으면 새 프로젝트 UI에 유령 첨부가 남지 않도록 무시
      // (DB에는 저장되므로 원 프로젝트로 돌아오면 hydrate 시 목록에 나타남.
      //  isAttachmentLoading은 hydrateForProject가 false로 리셋함)
      if (get().loadedProjectId !== projectId) return;
      set((state) => ({
        attachments: [...state.attachments, newAtt],
        isAttachmentLoading: false,
      }));
    } catch (e) {
      console.error('[chatStore] attachFile failed (raw):', e);
      const message = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
      // L5: 프로젝트가 전환됐으면 새 프로젝트 상태에 stale 에러를 쓰지 않음
      if (get().loadedProjectId === projectId) {
        set({
          isAttachmentLoading: false,
          error: message,
        });
      }
      throw e; // UI에서 토스트로 표시할 수 있도록 re-throw
    }
  };

  const deleteAttachment = async (id: string): Promise<void> => {
    set({ isAttachmentLoading: true });
    try {
      await deleteAttachmentApi(id);
      set((state) => ({
        attachments: state.attachments.filter((a) => a.id !== id),
        isAttachmentLoading: false,
      }));
    } catch (e) {
      set({
        isAttachmentLoading: false,
        error: e instanceof Error ? e.message : '첨부 파일 삭제 실패',
      });
    }
  };

  const addComposerAttachment = async (path: string): Promise<void> => {
    // 채팅 컴포저 첨부는 프로젝트(Settings) 첨부와 분리: DB에 저장하지 않고, 모델 호출 payload에만 사용
    if (!get().loadedProjectId) return;

    // Note: isLoading을 사용하지 않음 - AI 응답 생성용 플래그이므로 첨부 시 스켈레톤이 표시되는 문제 방지
    try {
      const tmp = await previewAttachment(path);

      // 이미지 파일인 경우 썸네일 data URL 생성 + API 제한에 맞게 리사이즈
      const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
      if (imageExtensions.includes(tmp.fileType.toLowerCase()) && tmp.filePath) {
        const rawDataUrl = await readImageAsDataUrl(tmp.filePath, tmp.fileType);
        if (rawDataUrl) {
          // API 제한(Anthropic 5MB)에 맞게 자동 리사이즈
          const resizedDataUrl = await resizeImageForApi(rawDataUrl, IMAGE_SIZE_LIMITS.anthropic);
          tmp.thumbnailDataUrl = resizedDataUrl;
        }
      }

      set((state) => ({
        composerAttachments: [...state.composerAttachments, tmp],
      }));
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '첨부 파일 추가 실패',
      });
    }
  };

  const removeComposerAttachment = (id: string): void => {
    set((state) => ({
      composerAttachments: state.composerAttachments.filter((a) => a.id !== id),
    }));
  };

  const clearComposerAttachments = (): void => {
    set({ composerAttachments: [] });
  };

  const loadAttachments = async (): Promise<void> => {
    const projectId = get().loadedProjectId;
    if (!projectId) return;

    try {
      const atts = await listAttachments(projectId);
      set({ attachments: atts });
    } catch (e) {
      // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
      const message = e instanceof Error ? e.message : String(e);
      console.error('Failed to load attachments:', message);
    }
  };

  return {
    attachFile: attachFileAction,
    deleteAttachment,
    addComposerAttachment,
    removeComposerAttachment,
    clearComposerAttachments,
    loadAttachments,
  };
}

// ── Utility Actions ────────────────────────────────────────────────────

export function createUtilityActions(set: ChatSet) {
  const setLoading = (isLoading: boolean): void => {
    set({ isLoading });
  };

  const setError = (error: string | null): void => {
    set({ error });
  };

  const setStatusMessage = (message: string | null): void => {
    set({ statusMessage: message });
  };

  return {
    setLoading,
    setError,
    setStatusMessage,
  };
}
