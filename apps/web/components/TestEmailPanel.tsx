
import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
export interface TestEmailResult {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface TestEmailPanelProps {
  onSend: (email: string, signal?: AbortSignal) => Promise<TestEmailResult>;
}

export function TestEmailPanel({ onSend }: TestEmailPanelProps) {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<TestEmailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
  return () => {
    if (abortControllerRef.current) {
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    }
  };
  }, []);

  const send = useCallback(async () => {
  setLoading(true);
  setError(null);
  setResult(null);

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    setError('Please enter a valid email address');
    setLoading(false);
    return;
  }

  // Create new AbortController for this operation
  abortControllerRef.current = new AbortController();

  try {
    const response = await onSend(email, abortControllerRef.current.signal);
    setResult(response);
  } catch (e: unknown) {
    if (e instanceof Error && e.name !== 'AbortError') {
    setError(e.message || 'Failed to send test email');
    }
  } finally {
    setLoading(false);
    abortControllerRef.current = null;
  }
  }, [email, onSend]);

  return (
  <div>
    <h4>Send Test Email</h4>
    <input
    type='email'
    value={email}
    onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
    placeholder='test@example.com'
    aria-label='Email address'
    aria-describedby={error ? errorId : undefined}
    disabled={loading}
    />
    <button type='button' onClick={() => void send()} disabled={loading || !email}>
    {loading ? 'Sending…' : 'Send Test'}
    </button>
    {error && <div id={errorId} style={{ color: 'red' }}>{error}</div>}
    {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
  </div>
  );
}
