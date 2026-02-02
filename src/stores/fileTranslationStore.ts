import { create } from 'zustand';

// ============================================
// Types
// ============================================

export interface SlideData {
  index: number;
  title?: string | undefined;
  texts: string[];           // 슬라이드 내 텍스트들
  translatedTexts?: string[] | undefined; // 번역된 텍스트들
  status: 'pending' | 'translating' | 'done' | 'error';
  error?: string | undefined;
}

interface FileTranslationState {
  // 파일 정보
  filePath: string | null;
  fileName: string | null;

  // 슬라이드 데이터
  slides: SlideData[];

  // 번역 상태
  isExtracting: boolean;       // PPTX 추출 중
  isTranslating: boolean;      // 번역 진행 중
  currentSlideIndex: number | null; // 현재 번역 중인 슬라이드

  // 에러
  error: string | null;

  // AbortController
  abortController: AbortController | null;
}

interface FileTranslationActions {
  // 파일 로드
  setFile: (path: string, name: string) => void;
  clearFile: () => void;

  // 슬라이드 데이터 설정
  setSlides: (slides: SlideData[]) => void;
  updateSlideStatus: (index: number, status: SlideData['status'], error?: string) => void;
  updateSlideTranslation: (index: number, translatedTexts: string[]) => void;

  // 번역 제어
  setIsExtracting: (isExtracting: boolean) => void;
  startTranslation: () => void;
  stopTranslation: () => void;
  setCurrentSlideIndex: (index: number | null) => void;

  // 에러
  setError: (error: string | null) => void;

  // 리셋
  reset: () => void;

  // 헬퍼 셀렉터
  getCompletedCount: () => number;
  getTotalCount: () => number;
  getProgress: () => number;
}

type FileTranslationStore = FileTranslationState & FileTranslationActions;

// ============================================
// Initial State
// ============================================

const initialState: FileTranslationState = {
  filePath: null,
  fileName: null,
  slides: [],
  isExtracting: false,
  isTranslating: false,
  currentSlideIndex: null,
  error: null,
  abortController: null,
};

// ============================================
// Store Implementation
// ============================================

export const useFileTranslationStore = create<FileTranslationStore>((set, get) => ({
  ...initialState,

  // 파일 로드
  setFile: (path: string, name: string) => {
    set({
      filePath: path,
      fileName: name,
      error: null,
    });
  },

  clearFile: () => {
    const { abortController } = get();
    // 진행 중인 작업 중단
    if (abortController) {
      abortController.abort();
    }
    set(initialState);
  },

  // 슬라이드 데이터 설정
  setSlides: (slides: SlideData[]) => {
    set({ slides, error: null });
  },

  updateSlideStatus: (index: number, status: SlideData['status'], error?: string) => {
    const { slides } = get();
    const updatedSlides = slides.map((slide): SlideData => {
      if (slide.index === index) {
        const updated: SlideData = { ...slide, status };
        if (error !== undefined) {
          updated.error = error;
        } else {
          delete updated.error;
        }
        return updated;
      }
      return slide;
    });
    set({ slides: updatedSlides });
  },

  updateSlideTranslation: (index: number, translatedTexts: string[]) => {
    const { slides } = get();
    const updatedSlides = slides.map((slide): SlideData => {
      if (slide.index === index) {
        const updated: SlideData = { ...slide, translatedTexts, status: 'done' };
        delete updated.error;
        return updated;
      }
      return slide;
    });
    set({ slides: updatedSlides });
  },

  // 번역 제어
  setIsExtracting: (isExtracting: boolean) => {
    set({ isExtracting });
  },

  startTranslation: () => {
    const { abortController: prevController } = get();
    // 기존 컨트롤러가 있으면 중단
    if (prevController) {
      prevController.abort();
    }
    // 새 AbortController 생성
    const newController = new AbortController();
    set({
      isTranslating: true,
      abortController: newController,
      error: null,
    });
  },

  stopTranslation: () => {
    const { abortController, currentSlideIndex, slides } = get();
    // 진행 중인 작업 중단
    if (abortController) {
      abortController.abort();
    }
    // 현재 번역 중인 슬라이드의 상태를 'pending'으로 되돌림
    let updatedSlides = slides;
    if (currentSlideIndex !== null) {
      updatedSlides = slides.map((slide): SlideData => {
        if (slide.index === currentSlideIndex && slide.status === 'translating') {
          const updated: SlideData = { ...slide, status: 'pending' };
          delete updated.error;
          return updated;
        }
        return slide;
      });
    }
    set({
      isTranslating: false,
      abortController: null,
      currentSlideIndex: null,
      slides: updatedSlides,
    });
  },

  setCurrentSlideIndex: (index: number | null) => {
    set({ currentSlideIndex: index });
  },

  // 에러
  setError: (error: string | null) => {
    set({ error });
  },

  // 리셋
  reset: () => {
    const { abortController } = get();
    // 진행 중인 작업 중단
    if (abortController) {
      abortController.abort();
    }
    set(initialState);
  },

  // 헬퍼 셀렉터
  getCompletedCount: () => {
    const { slides } = get();
    return slides.filter((s) => s.status === 'done').length;
  },

  getTotalCount: () => {
    const { slides } = get();
    return slides.length;
  },

  getProgress: () => {
    const { slides } = get();
    const totalCount = slides.length;
    if (totalCount === 0) return 0;
    const completedCount = slides.filter((s) => s.status === 'done').length;
    return (completedCount / totalCount) * 100;
  },
}));
