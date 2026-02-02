import { useCallback, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, FileText } from 'lucide-react';

interface FileDropZoneProps {
  onFileSelect: (file: File) => void;
  onPickFile?: () => void; // Tauri 파일 다이얼로그를 통한 선택
}

/**
 * 드래그앤드롭으로 PPTX 파일을 선택하는 컴포넌트
 * - 드롭 영역 UI (대시 보더, 아이콘, 설명 텍스트)
 * - 클릭하면 파일 다이얼로그 열기
 * - 드래그 중 하이라이트 효과
 * - PPTX 파일만 허용
 */
export function FileDropZone({ onFileSelect, onPickFile }: FileDropZoneProps): JSX.Element {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const validateAndSelectFile = useCallback((file: File) => {
    // PPTX 파일만 허용
    const isPptx = file.name.toLowerCase().endsWith('.pptx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    if (!isPptx) {
      // TODO: 토스트로 에러 표시
      console.error('Invalid file type. Only .pptx files are allowed.');
      return;
    }

    onFileSelect(file);
  }, [onFileSelect]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0]) {
      validateAndSelectFile(files[0]);
    }
  }, [validateAndSelectFile]);

  const handleClick = useCallback(() => {
    // Tauri 환경에서는 네이티브 파일 다이얼로그 사용
    if (onPickFile) {
      onPickFile();
    } else {
      fileInputRef.current?.click();
    }
  }, [onPickFile]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && files[0]) {
      validateAndSelectFile(files[0]);
    }
    // 같은 파일 재선택을 위해 값 초기화
    e.target.value = '';
  }, [validateAndSelectFile]);

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-editor-bg">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          w-full max-w-lg p-12 rounded-xl
          border-2 border-dashed transition-all duration-200 cursor-pointer
          ${isDragOver
            ? 'border-primary-500 bg-primary-500/10 scale-[1.02]'
            : 'border-editor-border hover:border-primary-400 hover:bg-editor-surface/50'
          }
        `}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          {/* 아이콘 */}
          <div
            className={`
              w-16 h-16 rounded-full flex items-center justify-center transition-colors
              ${isDragOver ? 'bg-primary-500/20' : 'bg-editor-surface'}
            `}
          >
            {isDragOver ? (
              <FileUp className="w-8 h-8 text-primary-500" />
            ) : (
              <FileText className="w-8 h-8 text-editor-muted" />
            )}
          </div>

          {/* 타이틀 */}
          <h3 className="text-lg font-semibold text-editor-text">
            {t('fileTranslation.dropzone.title', 'PPTX 파일을 드래그하세요')}
          </h3>

          {/* 설명 */}
          <p className="text-sm text-editor-muted">
            {t('fileTranslation.dropzone.description', '또는 클릭하여 파일을 선택하세요')}
          </p>

          {/* 지원 포맷 */}
          <div className="mt-2 px-3 py-1.5 rounded-full bg-editor-surface text-xs text-editor-muted">
            {t('fileTranslation.dropzone.supportedFormat', '지원 포맷: .pptx')}
          </div>
        </div>
      </div>

      {/* 숨겨진 파일 입력 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        onChange={handleFileInputChange}
        className="hidden"
        aria-label={t('fileTranslation.dropzone.selectFile', '파일 선택')}
      />
    </div>
  );
}
