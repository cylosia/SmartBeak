
import React from 'react';
export function EmailComplianceHelper({ compliance }: any) {
  return (
  <div>
    <h4>Email Compliance Suggestions</h4>
    <textarea readOnly value={compliance.can_spam_footer} />
    <textarea readOnly value={compliance.gdpr_notice} />
    <textarea readOnly value={compliance.unsubscribe_copy} />
    <textarea readOnly value={compliance.data_usage_summary} />
  </div>
  );
}
