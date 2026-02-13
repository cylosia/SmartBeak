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
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
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
