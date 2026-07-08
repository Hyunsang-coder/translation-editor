import { create } from 'zustand';
import type { TipTapDocJson } from '@/utils/markdownConverter';

export type TranslationPreviewIntent = 'translate' | 'revise' | 'review_fix' | 'external';

/**
 * 캔버스 번역/폴리싱 스트리밍 채널 (P4).
 * onToken 델타를 캔버스 로컬 state 대신 여기에 기록하고, 표시하는 쪽(TranslatePreviewModal)만
 * 선택 구독해 캔버스(두 TipTap 에디터 포함) 전체 리렌더를 제거한다.
 */
export type PreviewStreamingChannel = 'translate' | 'polish';

interface TranslationPreviewState {
  open: boolean;
  title: string | null;
  docJson: TipTapDocJson | null;
  sourceHtml: string | null;
  originalHtml: string | null;
  sourceRevision: string | null;
  targetRevision: string | null;
  summary: string | null;
  intent: TranslationPreviewIntent;
  /**
   * L3: 프리뷰가 만들어진 시점의 프로젝트 ID.
   * applyDesktopTranslationPreview가 apply 시점에 현재 프로젝트와 재검증한다.
   */
  projectId: string | null;
  /** P4: 번역/폴리싱 스트리밍 텍스트 (프리뷰 필드와 독립적인 슬라이스) */
  streaming: Record<PreviewStreamingChannel, string | null>;
}

interface TranslationPreviewActions {
  setPreview: (payload: {
    title?: string | null;
    docJson: TipTapDocJson;
    sourceHtml?: string | null;
    originalHtml?: string | null;
    sourceRevision?: string | null;
    targetRevision?: string | null;
    summary?: string | null;
    intent?: TranslationPreviewIntent;
    projectId?: string | null;
  }) => void;
  clearPreview: () => void;
  setStreamingText: (channel: PreviewStreamingChannel, text: string | null) => void;
}

/** clearPreview가 리셋하는 프리뷰 필드 (streaming 슬라이스는 캔버스 스트림과 독립이라 유지) */
const previewInitialState = {
  open: false,
  title: null,
  docJson: null,
  sourceHtml: null,
  originalHtml: null,
  sourceRevision: null,
  targetRevision: null,
  summary: null,
  intent: 'external' as TranslationPreviewIntent,
  projectId: null,
};

export const useTranslationPreviewStore = create<TranslationPreviewState & TranslationPreviewActions>((set) => ({
  ...previewInitialState,
  streaming: { translate: null, polish: null },

  setPreview: (payload) => {
    set({
      open: true,
      title: payload.title ?? null,
      docJson: payload.docJson,
      sourceHtml: payload.sourceHtml ?? null,
      originalHtml: payload.originalHtml ?? null,
      sourceRevision: payload.sourceRevision ?? null,
      targetRevision: payload.targetRevision ?? null,
      summary: payload.summary ?? null,
      intent: payload.intent ?? 'external',
      projectId: payload.projectId ?? null,
    });
  },

  clearPreview: () => {
    set({ ...previewInitialState });
  },

  setStreamingText: (channel, text) => {
    set((state) =>
      state.streaming[channel] === text
        ? state
        : { streaming: { ...state.streaming, [channel]: text } },
    );
  },
}));
