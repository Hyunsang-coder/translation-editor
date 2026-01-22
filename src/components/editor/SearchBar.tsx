import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import { getSearchState } from '@/editor/extensions/SearchHighlight';

// ============================================
// Types
// ============================================

export interface SearchBarProps {
  editor: Editor | null;
  panelType: 'source' | 'target';
  isOpen: boolean;
  onClose: () => void;
  initialReplaceMode?: boolean;
}

// ============================================
// Component
// ============================================

/**
 * 검색/치환 바 컴포넌트
 * - 검색어 입력 및 하이라이트
 * - 대소문자 구분 토글
 * - 이전/다음 매치 탐색
 * - 치환 기능 (target 패널 전용)
 */
export function SearchBar({
  editor,
  panelType,
  isOpen,
  onClose,
  initialReplaceMode = false,
}: SearchBarProps): JSX.Element | null {
  const { t } = useTranslation();

  // 검색 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(initialReplaceMode && panelType === 'target');

  // 매치 정보 (에디터 storage에서 가져옴)
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // 검색어 변경 시 에디터에 반영
  useEffect(() => {
    if (!editor || !isOpen) return;

    // 검색어 설정 (debounce 없이 즉시 반영)
    editor.commands.setSearchTerm(searchTerm);

    // 매치 정보 업데이트
    const state = getSearchState(editor);
    if (state) {
      setMatchCount(state.matches.length);
      setCurrentIndex(state.currentIndex);
    }
  }, [editor, searchTerm, isOpen]);

  // 대소문자 구분 변경 시 에디터에 반영
  useEffect(() => {
    if (!editor || !isOpen) return;
    editor.commands.setCaseSensitive(caseSensitive);

    // 매치 정보 업데이트
    const state = getSearchState(editor);
    if (state) {
      setMatchCount(state.matches.length);
      setCurrentIndex(state.currentIndex);
    }
  }, [editor, caseSensitive, isOpen]);

  // 열릴 때 검색 입력창에 포커스
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [isOpen]);

  // 초기 치환 모드 설정
  useEffect(() => {
    if (isOpen && initialReplaceMode && panelType === 'target') {
      setShowReplace(true);
    }
  }, [isOpen, initialReplaceMode, panelType]);

  // 닫힐 때 검색 초기화
  useEffect(() => {
    if (!isOpen && editor) {
      editor.commands.clearSearch();
    }
  }, [isOpen, editor]);

  // 매치 정보 실시간 업데이트 (에디터 변경 감지)
  useEffect(() => {
    if (!editor || !isOpen) return;

    const updateMatchInfo = (): void => {
      const state = getSearchState(editor);
      if (state) {
        setMatchCount(state.matches.length);
        setCurrentIndex(state.currentIndex);
      }
    };

    // 에디터 업데이트 이벤트 구독
    editor.on('update', updateMatchInfo);
    editor.on('transaction', updateMatchInfo);

    return () => {
      editor.off('update', updateMatchInfo);
      editor.off('transaction', updateMatchInfo);
    };
  }, [editor, isOpen]);

  // 핸들러: 다음 매치
  const handleNextMatch = useCallback(() => {
    if (!editor) return;
    editor.commands.nextMatch();

    const state = getSearchState(editor);
    if (state) {
      setCurrentIndex(state.currentIndex);
    }
  }, [editor]);

  // 핸들러: 이전 매치
  const handlePrevMatch = useCallback(() => {
    if (!editor) return;
    editor.commands.prevMatch();

    const state = getSearchState(editor);
    if (state) {
      setCurrentIndex(state.currentIndex);
    }
  }, [editor]);

  // 핸들러: 현재 매치 치환
  const handleReplace = useCallback(() => {
    if (!editor || panelType !== 'target') return;
    editor.commands.replaceMatch(replaceTerm);
  }, [editor, replaceTerm, panelType]);

  // 핸들러: 모든 매치 치환
  const handleReplaceAll = useCallback(() => {
    if (!editor || panelType !== 'target') return;
    editor.commands.replaceAll(replaceTerm);
  }, [editor, replaceTerm, panelType]);

  // 핸들러: 대소문자 구분 토글
  const handleToggleCaseSensitive = useCallback(() => {
    setCaseSensitive((prev) => !prev);
  }, []);

  // 핸들러: 치환 모드 토글
  const handleToggleReplace = useCallback(() => {
    if (panelType !== 'target') return;
    setShowReplace((prev) => !prev);
  }, [panelType]);

  // 핸들러: 검색 입력 키보드 이벤트
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrevMatch();
        } else {
          handleNextMatch();
        }
      }
    },
    [onClose, handleNextMatch, handlePrevMatch]
  );

  // 핸들러: 치환 입력 키보드 이벤트
  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleReplace();
      }
    },
    [onClose, handleReplace]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="search-bar bg-editor-surface border-b border-editor-border px-3 py-2 flex flex-col gap-2">
      {/* 검색 행 */}
      <div className="flex items-center gap-2">
        {/* 검색 입력 */}
        <div className="flex-1 relative">
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('editor.search.placeholder', '검색어 입력...')}
            className="w-full h-7 pl-7 pr-2 text-sm bg-editor-bg border border-editor-border rounded focus:outline-none focus:ring-1 focus:ring-primary-500 text-editor-text placeholder:text-editor-muted"
          />
          {/* 검색 아이콘 */}
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-editor-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* 대소문자 구분 토글 */}
        <button
          type="button"
          onClick={handleToggleCaseSensitive}
          className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold border transition-colors ${
            caseSensitive
              ? 'bg-primary-500 text-white border-primary-500'
              : 'bg-editor-bg text-editor-muted border-editor-border hover:bg-editor-surface'
          }`}
          title={t('editor.search.caseSensitive', '대소문자 구분')}
        >
          Aa
        </button>

        {/* 이전 매치 */}
        <button
          type="button"
          onClick={handlePrevMatch}
          disabled={matchCount === 0}
          className="w-7 h-7 flex items-center justify-center rounded border border-editor-border bg-editor-bg text-editor-text hover:bg-editor-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={t('editor.search.prevMatch', '이전 (Shift+Enter)')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>

        {/* 다음 매치 */}
        <button
          type="button"
          onClick={handleNextMatch}
          disabled={matchCount === 0}
          className="w-7 h-7 flex items-center justify-center rounded border border-editor-border bg-editor-bg text-editor-text hover:bg-editor-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={t('editor.search.nextMatch', '다음 (Enter)')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* 매치 카운터 */}
        <span className="text-xs text-editor-muted min-w-[48px] text-center">
          {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : '0/0'}
        </span>

        {/* 치환 모드 토글 (target 패널만) */}
        {panelType === 'target' && (
          <button
            type="button"
            onClick={handleToggleReplace}
            className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
              showReplace
                ? 'bg-primary-500 text-white border-primary-500'
                : 'bg-editor-bg text-editor-muted border-editor-border hover:bg-editor-surface'
            }`}
            title={t('editor.search.toggleReplace', '치환 모드')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
          </button>
        )}

        {/* 닫기 버튼 */}
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded border border-editor-border bg-editor-bg text-editor-muted hover:text-editor-text hover:bg-editor-surface transition-colors"
          title={t('editor.search.close', '닫기 (Esc)')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 치환 행 (target 패널 + 치환 모드) */}
      {panelType === 'target' && showReplace && (
        <div className="flex items-center gap-2">
          {/* 치환 입력 */}
          <div className="flex-1">
            <input
              ref={replaceInputRef}
              type="text"
              value={replaceTerm}
              onChange={(e) => setReplaceTerm(e.target.value)}
              onKeyDown={handleReplaceKeyDown}
              placeholder={t('editor.search.replacePlaceholder', '치환어 입력...')}
              className="w-full h-7 px-2 text-sm bg-editor-bg border border-editor-border rounded focus:outline-none focus:ring-1 focus:ring-primary-500 text-editor-text placeholder:text-editor-muted"
            />
          </div>

          {/* 치환 버튼 */}
          <button
            type="button"
            onClick={handleReplace}
            disabled={matchCount === 0}
            className="h-7 px-3 text-xs font-medium rounded border border-editor-border bg-editor-bg text-editor-text hover:bg-editor-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={t('editor.search.replace', '치환')}
          >
            {t('editor.search.replace', '치환')}
          </button>

          {/* 모두 치환 버튼 */}
          <button
            type="button"
            onClick={handleReplaceAll}
            disabled={matchCount === 0}
            className="h-7 px-3 text-xs font-medium rounded border border-editor-border bg-editor-bg text-editor-text hover:bg-editor-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={t('editor.search.replaceAll', '모두 치환')}
          >
            {t('editor.search.replaceAll', '모두 치환')}
          </button>
        </div>
      )}
    </div>
  );
}
