
import React, { useState, useEffect, useRef, useCallback } from 'react';
export interface PublishIntentRetryButtonProps {
  intentId: string;
  onRetry: (intentId: string, signal?: AbortSignal) => Promise<void>;
}

export function PublishIntentRetryButton({ intentId, onRetry }: PublishIntentRetryButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
  return () => {
    // Cleanup if component unmounts during async operation
    if (abortControllerRef.current) {
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    }
  };
  }, []);

  const handleRetry = useCallback(async () => {
  setLoading(true);
  setError(null);
  setSuccess(false);

  // Create new AbortController for this operation
  abortControllerRef.current = new AbortController();

  try {
    await onRetry(intentId, abortControllerRef.current.signal);
    setSuccess(true);
  } catch (e: unknown) {
    if (e instanceof Error && e.name !== 'AbortError') {
    setError(e.message || 'Retry failed');
    }
  } finally {
    setLoading(false);
    abortControllerRef.current = null;
  }
  }, [intentId, onRetry]);

  return (
  <div>
    <button type='button' onClick={() => void handleRetry()} disabled={loading}>
    {loading ? 'Retrying…' : 'Retry'}
    </button>
    {/* P2-FIX: aria-live regions ensure screen readers announce state changes
        without requiring the user to move focus. role="status" (polite) for
        success and role="alert" (assertive) for errors match ARIA best practice. */}
    {success && <div role='status' aria-live='polite' style={{ color: 'green' }}>Retry queued</div>}
    {error && <div role='alert' aria-live='assertive' style={{ color: 'red' }}>{error}</div>}
  </div>
  );
}
