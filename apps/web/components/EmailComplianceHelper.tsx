
import React from 'react';

// P2-TYPE FIX: Replace any props with proper interface
interface ComplianceData {
  can_spam_footer?: string;
  gdpr_notice?: string;
  unsubscribe_copy?: string;
  data_usage_summary?: string;
}

export function EmailComplianceHelper({ compliance }: { compliance: ComplianceData }) {
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
