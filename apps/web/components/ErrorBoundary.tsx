import React from 'react';
import { t } from '../lib/i18n';

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // P1-SECURITY FIX: Never log full stack traces to the browser console in production.
    // console.error exposes internal file paths, component hierarchies, and library
    // versions to any user who opens DevTools — reducing the attacker's reconnaissance cost.
    if (process.env['NODE_ENV'] !== 'production') {
      console.error('ErrorBoundary caught an error:', error, info.componentStack);
    }
    // P1-OBSERVABILITY FIX: Report errors to the server for production monitoring.
    // Client-side console logs are lost when the user closes the page; backend
    // ingestion ensures errors appear in alerting dashboards.
    // Best-effort: if the reporting call fails, we do not re-throw (the UI fallback
    // is already rendered), and we log a dev-only warning.
    const payload = JSON.stringify({
      message: error.message,
      // Only include stack in non-production to limit exposure in transit
      ...(process.env['NODE_ENV'] !== 'production' && { stack: error.stack }),
      componentStack: info.componentStack,
    });
    window
      .fetch('/api/v1/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        // Keep connection open for up to 5 s; don't block page teardown
        keepalive: true,
      })
      .catch((reportingError: unknown) => {
        if (process.env['NODE_ENV'] !== 'production') {
          console.warn('ErrorBoundary: failed to report error to server', reportingError);
        }
      });
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ padding: 48, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <h1>{t('errors.title')}</h1>
          <p>{t('errors.description')}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              cursor: 'pointer',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: '#fff',
            }}
          >
            {t('common.reloadPage')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
