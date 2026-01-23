import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface UpdateModalProps {
  isOpen: boolean;
  version: string;
  releaseNotes: string | undefined;
  downloading: boolean;
  progress: number;
  error: string | null;
  onUpdate: () => void | Promise<void>;
  onCancel: () => void;
  onSkipVersion: () => void;
  onDismiss: () => void;
}

export function UpdateModal({
  isOpen,
  version,
  releaseNotes,
  downloading,
  progress,
  error,
  onUpdate,
  onCancel,
  onSkipVersion,
  onDismiss,
}: UpdateModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[400px] p-6">
        <h2 className="text-lg font-semibold mb-4">
          {t('update.newVersionAvailable', '새로운 버전이 있습니다')}
        </h2>

        <p className="text-gray-600 dark:text-gray-300 mb-4">
          {t('update.versionInfo', 'OddEyes.ai {{version}} 버전을 사용할 수 있습니다.', { version })}
        </p>

        {releaseNotes && (
          <div className="bg-gray-100 dark:bg-gray-700 rounded p-3 mb-4 max-h-32 overflow-y-auto text-sm prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{releaseNotes}</ReactMarkdown>
          </div>
        )}

        {error && (
          <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded p-3 mb-4 text-sm">
            <p>{t('update.downloadFailed', '다운로드에 실패했습니다. 나중에 다시 시도해주세요.')}</p>
            <p className="mt-1 text-xs opacity-75 font-mono">{error}</p>
          </div>
        )}

        {downloading ? (
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span>{t('update.downloading', '다운로드 중...')}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                {t('update.cancel', '취소')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between">
            <button
              onClick={onSkipVersion}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              {t('update.skipVersion', '이 버전 건너뛰기')}
            </button>
            <div className="flex gap-3">
              <button
                onClick={onDismiss}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                {t('update.later', '나중에')}
              </button>
              <button
                onClick={onUpdate}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {t('update.updateNow', '지금 업데이트')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
