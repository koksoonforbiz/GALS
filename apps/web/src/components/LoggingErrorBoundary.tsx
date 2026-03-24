import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  sessionId: string;
  userId: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

export class LoggingErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const token = localStorage.getItem('token');
    const body = {
      sessionId: this.props.sessionId,
      userId: this.props.userId,
      errorMessage: error.message,
      stack: (error.stack || '').slice(0, 2000),
      componentName: (errorInfo.componentStack || '').slice(0, 500),
      pageUrl: window.location.pathname,
      timestamp: Date.now(),
      errorType: 'react_boundary',
    };

    fetch('/api/logs/errors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <div className="mb-4 text-red-500">
            <AlertCircle size={48} />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Something went wrong</h2>
          <p className="text-gray-500 mb-6">
            Your session data has been saved. You can reload to continue.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
