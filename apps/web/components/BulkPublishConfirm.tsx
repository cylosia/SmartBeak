
import React from 'react';

interface BulkPublishSummary {
  drafts: number;
  targets: number;
  totalCombinations: number;
}

interface BulkPublishConfirmProps {
  summary: BulkPublishSummary;
  onConfirm: () => void;
}

export function BulkPublishConfirm({ summary, onConfirm }: BulkPublishConfirmProps) {
  return (
  <div>
    <h3>Confirm Bulk Publish</h3>
    <pre>{JSON.stringify(summary, null, 2)}</pre>
    <button onClick={onConfirm}>
    Confirm & Create Publish Intents
    </button>
  </div>
  );
}
