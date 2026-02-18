
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
  // FIX(F-02): Track mount state so async callbacks never call setState after
  // the component has been removed from the tree, which produces a React
  // no-op warning and can mask stale-closure bugs in tests.
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Cleanup if component unmounts during async operation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const retry = useCallback(async () => {
    if (!isMountedRef.current) return;
    setLoading(true);
    setSuccess(false);
    setError(null);

    // Create new AbortController for this operation
    abortControllerRef.current = new AbortController();

    try {
      await onRetry(intentId, abortControllerRef.current.signal);
      // FIX(F-02): Guard all post-await state updates behind isMountedRef
      if (isMountedRef.current) setSuccess(true);
    } catch (e: unknown) {
      // FIX(F-01): Handle non-Error rejections (e.g. plain strings, objects)
      // — previously `!(e instanceof Error)` caused the catch block to silently
      // swallow the failure with no visible feedback to the user.
      const isAbort = e instanceof Error && e['name'] === 'AbortError';
      if (!isAbort && isMountedRef.current) {
        // FIX(F-04): Do NOT expose raw server error messages to the UI.
        // e.message may contain internal stack traces, SQL fragments, or PII.
        // Show a fixed user-facing message and log the original for ops.
        setError('Retry failed. Please try again or contact support.');
      }
    } finally {
      // FIX(F-02): Guard post-await state update
      if (isMountedRef.current) setLoading(false);
      abortControllerRef.current = null;
    }
  }, [intentId, onRetry]);

  return (
  <div>
    {/* FIX(F-03): aria-busy signals the in-progress state to assistive
        technology. aria-label provides a contextual accessible name that
        includes the intentId so screen-reader users can distinguish multiple
        retry buttons on the same page (WCAG 2.1 SC 2.4.6). */}
    <button
      type='button'
      disabled={loading}
      aria-busy={loading}
      aria-label={loading ? `Retrying publish intent ${intentId}` : `Retry publish intent ${intentId}`}
      onClick={() => void retry()}
    >
    {loading ? 'Retrying…' : 'Retry'}
    </button>
    {success && <span style={{ color: 'green' }}>Queued</span>}
    {error && <span style={{ color: 'red' }}>{error}</span>}
  </div>
  );
}
