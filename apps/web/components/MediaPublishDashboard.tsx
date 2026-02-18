
import React from 'react';

import { MediaPublishRetryButton } from './MediaPublishRetryButton';
// FIX(E-02): Constrain status to the known discriminated union values so that
// `intent.status === 'failed'` is a type-safe exhaustive check. Previously
// `status: string` silently missed casing variants ('FAILED', 'error', etc.)
// and made the Actions column invisible for mismatched statuses.
export type PublishIntentStatus = 'pending' | 'published' | 'failed' | 'scheduled';

export interface PublishIntent {
  id: string;
  platform: string;
  status: PublishIntentStatus;
  scheduledFor?: string | null;
}

export interface MediaPublishDashboardProps {
  intents?: PublishIntent[];
  onRetry?: (intentId: string) => Promise<void>;
}

export function MediaPublishDashboard({ intents = [], onRetry }: MediaPublishDashboardProps) {
  return (
  <div>
    <h2>Media Publishing</h2>
    {intents.length === 0 ? (
    <p>No publish intents yet. Create one to get started.</p>
    ) : (
    <table>
      <caption>Published content across platforms</caption>
      <thead>
      <tr>
        <th scope='col'>Platform</th>
        <th scope='col'>Status</th>
        <th scope='col'>Schedule</th>
        <th scope='col'>Actions</th>
      </tr>
      </thead>
      <tbody>
      {intents.map((intent) => (
        <tr key={intent["id"]}>
        <td>{intent.platform}</td>
        <td>{intent.status}</td>
        {/* FIX(E-01): Format the ISO 8601 scheduledFor string into a
            human-readable local date/time instead of rendering it verbatim.
            The raw string (e.g. "2026-03-01T14:00:00Z") is illegible to
            non-technical users. Guarding with a try/catch prevents an
            invalid date string from crashing the row render. */}
        <td>{intent.scheduledFor
          ? (() => {
              try { return new Date(intent.scheduledFor).toLocaleString(); }
              catch { return intent.scheduledFor; }
            })()
          : 'Now'}</td>
        <td>
          {intent.status === 'failed' && onRetry && (
          <MediaPublishRetryButton intentId={intent["id"]} onRetry={onRetry} />
          )}
        </td>
        </tr>
      ))}
      </tbody>
    </table>
    )}
  </div>
  );
}
