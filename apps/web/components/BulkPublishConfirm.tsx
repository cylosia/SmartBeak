
import React, { useState } from 'react';

interface BulkPublishSummary {
  drafts: number;
  targets: number;
  totalCombinations: number;
}

// P2-FIX: Added onCancel prop so the dialog can be dismissed without action.
interface BulkPublishConfirmProps {
  summary: BulkPublishSummary;
  onConfirm: () => void;
  onCancel: () => void;
}

// P2-FIX: Added acknowledgment checkbox and Cancel button.
// Bulk publish is an irreversible operation — a misclick on the old single-button
// dialog created hundreds or thousands of publish intents with no undo path.
// Confirm is disabled until the user explicitly checks the acknowledgment.
export function BulkPublishConfirm({ summary, onConfirm, onCancel }: BulkPublishConfirmProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
  <div>
    <h3>Confirm Bulk Publish</h3>
    <p>
    This will create <strong>{summary.totalCombinations}</strong> publish intent(s)
    from <strong>{summary.drafts}</strong> draft(s) across <strong>{summary.targets}</strong> target(s).
    This action cannot be undone.
    </p>
    <label>
    <input
      type='checkbox'
      checked={acknowledged}
      onChange={(e) => setAcknowledged(e.target.checked)}
    />
    {' '}I understand this will publish {summary.totalCombinations} item(s) and cannot be undone
    </label>
    <div>
    <button type='button' onClick={onCancel}>
      Cancel
    </button>
    <button type='button' onClick={onConfirm} disabled={!acknowledged}>
      Confirm &amp; Create Publish Intents
    </button>
    </div>
  </div>
  );
}
