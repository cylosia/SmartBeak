
import React, { useState, useEffect, useRef, useCallback } from 'react';
export interface MediaPublishRetryButtonProps {
  intentId: string;
  onRetry: (intentId: string, signal?: AbortSignal) => Promise<void>;
}

export function MediaPublishRetryButton({ intentId, onRetry }: MediaPublishRetryButtonProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const retry = useCallback(async () => {
  setLoading(true);
  setSuccess(false);
  setError(null);

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
    <button type='button' disabled={loading} onClick={retry}>
    {loading ? 'Retrying…' : 'Retry'}
    </button>
    {success && <span style={{ color: 'green' }}>Queued</span>}
    {error && <span style={{ color: 'red' }}>{error}</span>}
  </div>
  );
}
