
import React from 'react';

import { MediaPublishRetryButton } from './MediaPublishRetryButton';
export interface PublishIntent {
  id: string;
  platform: string;
  status: string;
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
        <td>{intent.scheduledFor || 'Now'}</td>
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
