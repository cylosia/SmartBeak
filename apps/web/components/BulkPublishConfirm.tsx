
import React from 'react';
export function BulkPublishConfirm({ summary, onConfirm }: any) {
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
