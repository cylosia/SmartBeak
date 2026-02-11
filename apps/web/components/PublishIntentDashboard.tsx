
import React from 'react';

import { PublishIntentRetryButton } from './PublishIntentRetryButton';
export type Intent = {
  id: string;
  target: string;
  status: 'pending' | 'publishing' | 'published' | 'failed';
  scheduledFor?: string | null;
};

export function PublishIntentDashboard({ intents, onRetry }: { intents: Intent[], onRetry: (id: string) => Promise<void> }) {
  return (
  <div>
    <h2>Publish Status</h2>
    <table>
    <thead>
      <tr>
      <th scope='col'>Target</th>
      <th scope='col'>Status</th>
      <th scope='col'>Scheduled</th>
      <th scope='col'>Actions</th>
      </tr>
    </thead>
    <tbody>
      {intents.map(i => (
      <tr key={i["id"]}>
        <td>{i.target}</td>
        <td>{i.status}</td>
        <td>{i.scheduledFor || 'Now'}</td>
        <td>
        {i.status === 'failed' && (
          <PublishIntentRetryButton
          intentId={i["id"]}
          onRetry={onRetry}
          />
        )}
        </td>
      </tr>
      ))}
    </tbody>
    </table>
  </div>
  );
}
