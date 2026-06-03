import React from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Minimal, dependency-free React error boundary. Use it to scope a
 * crashing subtree so the parent route doesn't blank out — currently
 * any unhandled render error in CourseBuilderPage's editor subtree
 * (e.g. the RichTextEditor TDZ bug) propagates to the root and the
 * teacher sees nothing.
 *
 * The existing `LoggingErrorBoundary` reports to /api/logs/errors but
 * requires `sessionId` + `userId`, which the teacher routes don't
 * always have. This is the no-context variant.
 *
 * NOTE: hooks cannot catch render errors — boundaries must be class
 * components. The render() body here is intentionally tiny.
 */
interface Props {
  children: React.ReactNode;
  /** Custom fallback. Receives the error so callers can render a tailored UI. */
  fallback?: (error: Error, retry: () => void) => React.ReactNode;
  /** Human label used in the default fallback header. Defaults to "this section". */
  label?: string;
  /** Optional callback for telemetry / logging. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console so the dev can still see the full stack in the
    // browser DevTools — boundaries swallow errors otherwise.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    const label = this.props.label ?? 'this section';
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] p-6 text-center bg-red-50 border border-red-200 rounded-lg">
        <div className="mb-3 text-red-500">
          <AlertCircle size={32} />
        </div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">
          Something went wrong in {label}.
        </h3>
        <p className="text-xs text-gray-600 mb-4 max-w-md font-mono break-words">
          {error.message}
        </p>
        <div className="flex gap-2">
          <button
            onClick={this.reset}
            className="px-3 py-1.5 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
