import { Component, type ReactNode } from 'react';
import i18n from '@/i18n/config';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  name?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 범용 Error Boundary
 * 자식 컴포넌트의 렌더링 에러를 잡아 앱 전체 크래시를 방지합니다.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-editor-muted">
          <p className="text-sm mb-2">
            {this.props.name
              ? i18n.t('common.errorOccurredIn', { name: this.props.name })
              : i18n.t('common.errorOccurred')}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="px-3 py-1.5 text-xs bg-editor-surface border border-editor-border rounded hover:bg-editor-hover transition-colors"
          >
            {i18n.t('common.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
