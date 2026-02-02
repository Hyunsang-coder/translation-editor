import { useMemo, Component, type ReactNode } from 'react';
import Editor from '@monaco-editor/react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import { useUIStore } from '@/stores/uiStore';

export interface SourceMonacoEditorProps {
  value: string;
  onChange?: (next: string) => void;
}

// Error Boundary for Monaco Editor
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, resetErrorBoundary: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class EditorErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetErrorBoundary);
      }
      return (
        <EditorErrorFallback
          error={this.state.error}
          resetErrorBoundary={this.resetErrorBoundary}
        />
      );
    }
    return this.props.children;
  }
}

function EditorErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-editor-bg border border-editor-border rounded-md p-4">
      <p className="text-red-500 mb-2">Editor failed to load</p>
      <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
      <button
        onClick={resetErrorBoundary}
        className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Source 참고용 에디터 (Monaco)
 * - 기본적으로 읽기 전용 모드였으나, 요청에 따라 편집 가능하게 구성합니다.
 */
export function SourceMonacoEditor({ value, onChange }: SourceMonacoEditorProps): JSX.Element {
  const theme = useUIStore((s) => s.theme);

  const monacoTheme = useMemo(() => {
    if (theme === 'dark') return 'vs-dark';
    if (theme === 'light') return 'light';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'vs-dark' : 'light';
  }, [theme]);

  const options: MonacoEditorNS.IStandaloneEditorConstructionOptions = useMemo(
    () => ({
      fontFamily:
        "'Noto Sans KR', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      fontSize: 16,
      lineHeight: 28,
      lineNumbers: 'off',
      minimap: { enabled: false },
      glyphMargin: false,
      wordWrap: 'on',
      renderLineHighlight: 'none',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      readOnly: false,
      domReadOnly: false,
      contextmenu: true,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      parameterHints: { enabled: false },
      lightbulb: { enabled: 'off' as unknown as MonacoEditorNS.ShowLightbulbIconMode },
    }),
    [],
  );

  return (
    <EditorErrorBoundary>
      <div className="h-full w-full rounded-md border border-editor-border bg-editor-bg overflow-hidden">
        <Editor
          height="100%"
          language="plaintext"
          theme={monacoTheme}
          value={value}
          options={options}
          onChange={(next) => onChange?.(next ?? '')}
        />
      </div>
    </EditorErrorBoundary>
  );
}


