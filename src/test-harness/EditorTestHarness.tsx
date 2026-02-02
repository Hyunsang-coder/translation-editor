/**
 * 에디터 붙여넣기 테스트용 Harness
 * - Tauri/API 키 없이 에디터만 독립 테스트
 * - Playwright E2E 테스트에서 사용
 */
import { useState, useCallback, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ImagePlaceholder } from '@/editor/extensions/ImagePlaceholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { normalizePastedHtml } from '@/utils/htmlNormalizer';
import '../index.css';

// 복사 버튼 컴포넌트
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-2 px-2 py-0.5 text-xs bg-gray-600 hover:bg-gray-500 rounded"
      title={`Copy ${label}`}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// 결과 섹션 컴포넌트
function ResultSection({
  label,
  content,
  colorClass,
  children,
}: {
  label: string;
  content: string;
  colorClass: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center">
        <span className={colorClass}>{label}:</span>
        <CopyButton text={content} label={label} />
      </div>
      {children || (
        <pre className="mt-1 bg-gray-900 p-2 rounded overflow-x-auto text-xs max-h-24 overflow-y-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

interface TestResult {
  inputHtml: string;
  normalizedHtml: string;
  editorHtml: string;
  editorJson: Record<string, unknown>;
  timestamp: number;
}

export function EditorTestHarness() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [rawHtmlInput, setRawHtmlInput] = useState('');

  // SourceTipTapEditor와 동일한 설정 사용
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'tiptap-link',
        },
      }),
      Placeholder.configure({
        placeholder: '붙여넣기 테스트 영역',
        emptyEditorClass: 'tiptap-empty',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ImagePlaceholder.configure({ inline: true, allowBase64: true }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Subscript,
      Superscript,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none min-h-[200px] p-4',
      },
      transformPastedHTML: (html) => {
        const normalized = normalizePastedHtml(html);
        // 붙여넣기 시 결과 기록
        setTimeout(() => {
          if (editor) {
            const result: TestResult = {
              inputHtml: html,
              normalizedHtml: normalized,
              editorHtml: editor.getHTML(),
              editorJson: editor.getJSON() as Record<string, unknown>,
              timestamp: Date.now(),
            };
            setResults((prev) => [result, ...prev].slice(0, 10));
          }
        }, 100);
        return normalized;
      },
    },
  });

  // 프로그래매틱하게 HTML 삽입 (테스트용)
  const injectHtml = useCallback(() => {
    if (!editor || !rawHtmlInput.trim()) return;

    const normalized = normalizePastedHtml(rawHtmlInput);
    editor.commands.setContent(normalized);

    const result: TestResult = {
      inputHtml: rawHtmlInput,
      normalizedHtml: normalized,
      editorHtml: editor.getHTML(),
      editorJson: editor.getJSON() as Record<string, unknown>,
      timestamp: Date.now(),
    };
    setResults((prev) => [result, ...prev].slice(0, 10));
  }, [editor, rawHtmlInput]);

  const clearEditor = useCallback(() => {
    editor?.commands.clearContent();
    setResults([]);
  }, [editor]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Editor Paste Test Harness</h1>
        <p className="text-gray-400 text-sm mt-1">
          붙여넣기 또는 HTML 직접 주입으로 normalizePastedHtml 동작 테스트
        </p>
      </header>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Editor */}
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-3">Editor (붙여넣기 영역)</h2>
            <div
              className="tiptap-wrapper source-editor"
              data-testid="paste-editor"
            >
              <EditorContent editor={editor} className="h-full" />
            </div>
            <button
              onClick={clearEditor}
              className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              Clear
            </button>
          </div>

          {/* Manual HTML injection */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-3">HTML 직접 주입</h2>
            <textarea
              value={rawHtmlInput}
              onChange={(e) => setRawHtmlInput(e.target.value)}
              placeholder="테스트할 HTML을 입력하세요..."
              className="w-full h-32 bg-gray-700 text-gray-100 rounded p-3 font-mono text-sm"
              data-testid="html-input"
            />
            <button
              onClick={injectHtml}
              className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
              data-testid="inject-button"
            >
              Inject HTML
            </button>
          </div>
        </div>

        {/* Right: Results */}
        <div className="bg-gray-800 rounded-lg p-4 max-h-[80vh] overflow-y-auto">
          <h2 className="text-lg font-semibold mb-3">
            Results
            <span className="text-gray-400 text-sm ml-2">({results.length})</span>
          </h2>

          {results.length === 0 ? (
            <p className="text-gray-500">붙여넣기하면 결과가 여기 표시됩니다</p>
          ) : (
            <div className="space-y-4">
              {results.map((result, idx) => (
                <div
                  key={result.timestamp}
                  className="bg-gray-700 rounded p-3 text-sm"
                  data-testid={`result-${idx}`}
                >
                  <ResultSection
                    label="Input HTML"
                    content={result.inputHtml}
                    colorClass="text-gray-400"
                  />
                  <ResultSection
                    label="Normalized HTML"
                    content={result.normalizedHtml}
                    colorClass="text-green-400"
                  />
                  <ResultSection
                    label="Editor HTML"
                    content={result.editorHtml}
                    colorClass="text-blue-400"
                  />
                  <details>
                    <summary className="text-yellow-400 cursor-pointer flex items-center">
                      Editor JSON
                      <CopyButton
                        text={JSON.stringify(result.editorJson, null, 2)}
                        label="JSON"
                      />
                    </summary>
                    <pre className="mt-1 bg-gray-900 p-2 rounded overflow-x-auto text-xs max-h-48 overflow-y-auto">
                      {JSON.stringify(result.editorJson, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Test fixtures (for Playwright) */}
      <div className="mt-6 bg-gray-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Quick Test Cases</h2>
        <div className="flex flex-wrap gap-2">
          {TEST_FIXTURES.map((fixture) => (
            <button
              key={fixture.name}
              onClick={() => {
                setRawHtmlInput(fixture.html);
              }}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              data-testid={`fixture-${fixture.name}`}
            >
              {fixture.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// 테스트 케이스 모음
const TEST_FIXTURES = [
  {
    name: 'confluence-image',
    html: '<ac:image><ri:attachment ri:filename="test.png" /></ac:image>',
  },
  {
    name: 'confluence-video',
    html: '<ac:structured-macro ac:name="multimedia"><ri:attachment ri:filename="video.mp4" /></ac:structured-macro>',
  },
  {
    name: 'inline-bold',
    html: '<span style="font-weight: bold">Bold text</span>',
  },
  {
    name: 'xss-javascript',
    html: '<a href="javascript:alert(1)">Click me</a><img src="x" onerror="alert(1)" />',
  },
  {
    name: 'xss-data-html',
    html: '<a href="data:text/html,<script>alert(1)</script>">data uri</a>',
  },
  {
    name: 'complex-table',
    html: `<table class="confluenceTable">
      <thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>
      <tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody>
    </table>`,
  },
  {
    name: 'nested-styles',
    html: '<span style="font-weight: bold"><span style="font-style: italic">Bold Italic</span></span>',
  },
  {
    name: 'iframe-embed',
    html: '<iframe src="https://youtube.com/embed/xxx"></iframe>',
  },
  {
    name: 'confluence-list-image',
    html: `<ul><li>항목 텍스트<div data-node-type="mediaSingle"><img src="test.png" alt="[Image]"></div></li><li>다음 항목</li></ul>`,
  },
  {
    name: 'confluence-nested-list',
    html: `<ul><li><p>부모 항목</p><ul><li><div data-node-type="mediaSingle"><img src="test.png" alt="[Image]"></div></li></ul></li></ul>`,
  },
];

export default EditorTestHarness;
