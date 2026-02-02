import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, X } from 'lucide-react';
import { FileDropZone } from './FileDropZone';
import { SlideList, type SlideItem } from './SlideList';
import { TranslationProgress } from './TranslationProgress';
import { useFileTranslationStore, type SlideData } from '@/stores/fileTranslationStore';
import { extractPptxTexts, writeTranslatedPptx } from '@/tauri/pptx';
import { pickPptxFile, pickTranslatedPptxSavePath } from '@/tauri/dialog';
import { translatePptx } from '@/ai/file-translation';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * 파일 번역 모드의 메인 뷰
 * - 파일이 없으면 FileDropZone 표시
 * - 파일이 있으면 SlideList + TranslationProgress 표시
 */
export function FileTranslationView(): JSX.Element {
  const { t } = useTranslation();

  // 스토어에서 상태와 액션 가져오기
  const {
    filePath,
    fileName,
    slides,
    isExtracting,
    isTranslating,
    error,
    setFile,
    setSlides,
    setIsExtracting,
    startTranslation,
    stopTranslation,
    updateSlideStatus,
    updateSlideTranslation,
    setCurrentSlideIndex,
    setError,
    reset,
  } = useFileTranslationStore();

  const project = useProjectStore((s) => s.project);

  // SlideData를 SlideItem으로 변환
  const slideItems: SlideItem[] = slides.map((slide) => ({
    index: slide.index,
    title: slide.title,
    textPreview: slide.texts.slice(0, 3).join(' ').slice(0, 200) || '(텍스트 없음)',
    status: slide.status,
  }));

  const completedCount = slides.filter((s) => s.status === 'done').length;

  // 파일 선택 핸들러 (드롭존에서 File 객체 전달받음 - 웹 환경용)
  const handleFileSelect = useCallback(
    async (_file: File) => {
      // 드래그 앤 드롭으로 받은 파일은 Tauri에서 경로를 얻을 수 없으므로
      // 파일 다이얼로그를 통해 다시 선택하도록 안내
      await handlePickFile();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // 파일 다이얼로그로 직접 선택
  const handlePickFile = useCallback(async () => {
    try {
      const path = await pickPptxFile();
      if (!path) return;

      setFile(path, path.split('/').pop() ?? 'unknown.pptx');
      setIsExtracting(true);

      // PPTX에서 텍스트 추출
      const extracted = await extractPptxTexts(path);

      // 추출된 데이터를 SlideData 형식으로 변환
      const slideData: SlideData[] = extracted.slides.map((slide) => ({
        index: slide.slide_index,
        texts: slide.texts,
        status: 'pending' as const,
      }));

      setSlides(slideData);
      setIsExtracting(false);
    } catch (err) {
      setIsExtracting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [setFile, setSlides, setIsExtracting, setError]);

  const handleRemoveFile = useCallback(() => {
    reset();
  }, [reset]);

  const handleSlideClick = useCallback((index: number) => {
    // TODO: 슬라이드 상세 보기 구현
    console.log('Slide clicked:', index);
  }, []);

  const handleStartTranslation = useCallback(async () => {
    if (!filePath || slides.length === 0) return;

    // 프로젝트 설정에서 언어 정보 가져오기
    // 현재 프로젝트에 sourceLanguage가 없으므로 기본값 사용
    const sourceLanguage = 'en'; // TODO: 프로젝트 설정에서 가져오도록 수정
    const targetLanguage = project?.metadata.targetLanguage ?? 'ko';
    const domain = project?.metadata.domain ?? undefined;

    startTranslation();
    const { abortController } = useFileTranslationStore.getState();

    try {
      await translatePptx({
        slides: slides
          .filter((s) => s.status !== 'done')
          .map((s) => ({ index: s.index, texts: s.texts })),
        sourceLanguage,
        targetLanguage,
        domain,
        signal: abortController?.signal,
        onSlideStart: (index) => {
          setCurrentSlideIndex(index);
          updateSlideStatus(index, 'translating');
        },
        onSlideComplete: (index, translatedTexts) => {
          updateSlideTranslation(index, translatedTexts);
        },
        onSlideError: (index, err) => {
          updateSlideStatus(index, 'error', err.message);
        },
      });

      // 번역 완료
      const store = useFileTranslationStore.getState();
      if (!store.abortController?.signal.aborted) {
        stopTranslation();
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      }
      stopTranslation();
    }
  }, [
    filePath,
    slides,
    project,
    startTranslation,
    stopTranslation,
    setCurrentSlideIndex,
    updateSlideStatus,
    updateSlideTranslation,
    setError,
  ]);

  const handleStopTranslation = useCallback(() => {
    stopTranslation();
  }, [stopTranslation]);

  // 번역된 파일 다운로드
  const handleDownload = useCallback(async () => {
    if (!filePath || !fileName) return;

    try {
      // 저장 경로 선택
      const defaultName = fileName.replace('.pptx', '_translated.pptx');
      const outputPath = await pickTranslatedPptxSavePath(defaultName);
      if (!outputPath) return;

      // 번역된 텍스트로 새 PPTX 생성
      const translations = slides
        .filter((s) => s.translatedTexts)
        .map((s) => ({
          slide_index: s.index,
          texts: s.translatedTexts ?? [],
        }));

      await writeTranslatedPptx(filePath, outputPath, translations);

      // 성공 알림
      useUIStore.getState().addToast({
        type: 'success',
        message: t('fileTranslation.progress.downloadSuccess', '파일이 저장되었습니다'),
      });
    } catch (err) {
      useUIStore.getState().addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [filePath, fileName, slides, t]);

  // 파일이 없으면 드롭존 표시
  if (!filePath) {
    return <FileDropZone onFileSelect={handleFileSelect} onPickFile={handlePickFile} />;
  }

  // 추출 중이면 로딩 표시
  if (isExtracting) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-editor-bg text-editor-text">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mb-4" />
        <p className="text-editor-muted">슬라이드 추출 중...</p>
      </div>
    );
  }

  // 에러 표시
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-editor-bg text-editor-text p-8">
        <div className="text-red-500 mb-4">⚠️</div>
        <p className="text-red-500 mb-4">{error}</p>
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const allCompleted = slides.length > 0 && completedCount === slides.length;

  return (
    <div className="flex flex-col h-full bg-editor-bg">
      {/* 파일 정보 헤더 */}
      <div className="shrink-0 px-4 py-3 border-b border-editor-border bg-editor-surface/50">
        <div className="flex items-center gap-3">
          {/* 파일 아이콘 */}
          <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-orange-500" />
          </div>

          {/* 파일 정보 */}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium text-editor-text truncate">{fileName}</h2>
            <p className="text-xs text-editor-muted">
              {t('fileTranslation.header.slideCount', '{{count}}개 슬라이드', {
                count: slides.length,
              })}
            </p>
          </div>

          {/* 다운로드 버튼 (번역 완료 시) */}
          {allCompleted && (
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              {t('fileTranslation.progress.download', '다운로드')}
            </button>
          )}

          {/* 파일 제거 버튼 */}
          <button
            type="button"
            onClick={handleRemoveFile}
            disabled={isTranslating}
            className="p-2 rounded-lg text-editor-muted hover:text-editor-text hover:bg-editor-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={t('fileTranslation.header.removeFile', '파일 제거')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 슬라이드 목록 */}
      <SlideList slides={slideItems} onSlideClick={handleSlideClick} />

      {/* 번역 진행률 */}
      <TranslationProgress
        total={slides.length}
        completed={completedCount}
        isTranslating={isTranslating}
        onStart={handleStartTranslation}
        onStop={handleStopTranslation}
      />
    </div>
  );
}
