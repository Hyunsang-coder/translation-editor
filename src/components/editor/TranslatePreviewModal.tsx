import { useEffect, useMemo, useState, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { generateText } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { DiffEditor } from '@monaco-editor/react';
import { useUIStore } from '@/stores/uiStore';
import { stripHtml } from '@/utils/hash';
import type { TipTapDocJson } from '@/ai/translateDocument';

/**
 * Diff 비교를 위한 텍스트 정규화
 * - 줄 바꿈 통일 (Windows/Unix)
 * - 과도한 빈 줄 정리
 * - 앞뒤 공백 제거
 */
function normalizeDiffText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')           // Windows 줄 바꿈 → Unix
    .replace(/\n{3,}/g, '\n\n')       // 3개 이상 줄 바꿈 → 2개
    .replace(/[ \t]+$/gm, '')         // 줄 끝 공백 제거
    .trim();
}

/**
 * 문장 단위로 텍스트 분할
 * - 각 문장을 별도 줄로 변환하여 Monaco DiffEditor의 줄 매칭 정확도 향상
 * - 번역 비교 시 문장 구조 변화를 더 명확하게 표시
 */
function splitBySentence(text: string): string {
  return text
    // 문장 종결 부호 + 공백을 줄바꿈으로 변환 (한국어/영어/일본어/중국어 지원)
    .replace(/([.!?。！？])\s+/g, '$1\n')
    // 이미 있는 줄바꿈은 유지하되 과도한 줄바꿈 정리
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

/**
 * Diff용 최종 텍스트 준비
 * - 정규화 + 문장 분할
 */
function prepareDiffText(text: string): string {
  const normalized = normalizeDiffText(text);
  return splitBySentence(normalized);
}

export function TranslatePreviewModal(props: {
  open: boolean;
  title?: string;
  docJson: TipTapDocJson | null;
  originalHtml?: string | null;
  isLoading?: boolean;
  error?: string | null;
  onClose: () => void;
  onApply: () => void;
}): JSX.Element | null {
  const { open, title, docJson, originalHtml, isLoading, error, onClose, onApply } = props;
  const theme = useUIStore((s) => s.theme);
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>('preview');
  const diffEditorRef = useRef<any>(null);

  // originalHtml이 있고 내용이 있으면 기본적으로 diff 모드로 보여줍니다.
  useEffect(() => {
    if (open && originalHtml && stripHtml(originalHtml).trim().length > 0) {
      setViewMode('diff');
    } else {
      setViewMode('preview');
    }
  }, [open, originalHtml]);

  const content = useMemo(() => docJson ?? null, [docJson]);

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'tiptap-link' },
    }),
  ], []);

  const editor = useEditor({
    extensions,
    ...(content !== null && { content }),
    editable: false,
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none',
      },
    },
  });

  // diff용 텍스트 추출 (정규화 + 문장 분할 적용)
  const originalText = useMemo(() => {
    const raw = originalHtml ? stripHtml(originalHtml) : '';
    return prepareDiffText(raw);
  }, [originalHtml]);

  const translatedText = useMemo(() => {
    if (!docJson) return '';
    try {
      // TipTap JSON을 plain text로 변환 (Heading 등 구조 반영)
      const raw = generateText(docJson, extensions);
      return prepareDiffText(raw);
    } catch (err) {
      console.error('Failed to generate text from docJson:', err);
      return '';
    }
  }, [docJson, extensions]);

  const monacoTheme = (() => {
    if (theme === 'dark') return 'vs-dark';
    if (theme === 'light') return 'light';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'vs-dark' : 'light';
  })();

  // docJson이 비동기로 들어오므로, 에디터가 이미 생성된 뒤에도 content를 갱신해줘야 합니다.
  useEffect(() => {
    if (!editor) return;
    if (!open) return;
    if (!docJson) return;
    // setContent는 내부적으로 selection을 바꾸므로, focus는 건드리지 않습니다.
    editor.commands.setContent(docJson);
  }, [editor, open, docJson]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Monaco DiffEditor가 언마운트될 때 모델을 명시적으로 해제하여
  // "TextModel got disposed before DiffEditorWidget model got reset" 에러 방지
  useEffect(() => {
    return () => {
      if (diffEditorRef.current) {
        diffEditorRef.current.setModel(null);
        diffEditorRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-6xl h-[85vh] bg-editor-bg border border-editor-border rounded-lg overflow-hidden flex flex-col">
        <div className="h-12 px-4 border-b border-editor-border flex items-center justify-between bg-editor-surface">
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-editor-text">
              {title ?? '번역 미리보기'}
            </div>
            {originalText.trim().length > 0 && !isLoading && !error && (
              <div className="flex bg-editor-bg border border-editor-border rounded-md p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${viewMode === 'preview' ? 'bg-editor-surface text-primary-500 font-bold' : 'text-editor-muted hover:text-editor-text'}`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('diff')}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${viewMode === 'diff' ? 'bg-editor-surface text-primary-500 font-bold' : 'text-editor-muted hover:text-editor-text'}`}
                >
                  Diff
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors"
              onClick={onApply}
              disabled={isLoading || !docJson}
              title="Apply (전체 덮어쓰기)"
            >
              Apply
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-bg text-editor-text hover:bg-editor-border transition-colors"
              onClick={onClose}
              title="Close (ESC)"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-editor-muted">
              <div className="w-full max-w-md px-6">
                <div className="flex items-center justify-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary-500 animate-pulse" />
                  <div className="text-sm">번역 생성 중…</div>
                </div>
                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-editor-border/60">
                  <div className="h-full w-1/2 rounded-full bg-primary-500 animate-pulse" />
                </div>
                <div className="mt-2 text-center text-[11px] text-editor-muted">
                  응답을 기다리는 중입니다. 잠시만요.
                </div>
              </div>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-xl w-full bg-editor-surface border border-editor-border rounded-lg p-4">
                <div className="text-sm font-medium text-red-600 dark:text-red-400">
                  번역 미리보기를 생성할 수 없습니다
                </div>
                <div className="mt-2 text-sm text-editor-muted whitespace-pre-wrap">
                  {error}
                </div>
              </div>
            </div>
          ) : viewMode === 'diff' && originalText.trim().length > 0 ? (
            <div className="h-full">
              <DiffEditor
                height="100%"
                language="plaintext"
                theme={monacoTheme}
                original={originalText}
                modified={translatedText}
                onMount={(editor) => {
                  diffEditorRef.current = editor;
                }}
                options={{
                  renderSideBySide: true,
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  renderOverviewRuler: false,
                  folding: false,
                  diffAlgorithm: 'advanced',
                  ignoreTrimWhitespace: true,  // 앞뒤 공백 차이 무시
                  renderIndicators: true,
                  // 인라인 힌트 표시 (단어 단위 하이라이트)
                  renderMarginRevertIcon: false,
                  useInlineViewWhenSpaceIsLimited: false,
                }}
              />
            </div>
          ) : (
            <div className="h-full p-4 overflow-hidden">
              <div className="tiptap-wrapper h-full">
                {editor ? (
                  <EditorContent editor={editor} className="h-full" />
                ) : (
                  <div className="h-full animate-pulse bg-editor-surface rounded-md" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


