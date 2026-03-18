import { create } from 'zustand';
import type { TipTapDocJson } from '@/utils/markdownConverter';

export type TranslationPreviewIntent = 'translate' | 'revise' | 'review_fix' | 'external';

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
  }) => void;
  clearPreview: () => void;
}

const initialState: TranslationPreviewState = {
  open: false,
  title: null,
  docJson: null,
  sourceHtml: null,
  originalHtml: null,
  sourceRevision: null,
  targetRevision: null,
  summary: null,
  intent: 'external',
};

export const useTranslationPreviewStore = create<TranslationPreviewState & TranslationPreviewActions>((set) => ({
  ...initialState,

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
    });
  },

  clearPreview: () => {
    set(initialState);
  },
}));
