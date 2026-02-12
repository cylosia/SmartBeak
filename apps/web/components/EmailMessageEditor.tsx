
import React from 'react';

import { EmailComplianceHelper } from './EmailComplianceHelper';

// P2-TYPE FIX: Replace any props with proper interface
interface EmailMessageEditorProps {
  message: { subject: string; body: string };
  compliance: {
    can_spam_footer?: string;
    gdpr_notice?: string;
    unsubscribe_copy?: string;
    data_usage_summary?: string;
  };
}

export function EmailMessageEditor({ message, compliance }: EmailMessageEditorProps) {
  return (
  <div>
    <h3>Edit Email Message</h3>
    <input value={message.subject} readOnly />
    <textarea value={message.body} readOnly />
    <EmailComplianceHelper compliance={compliance} />
  </div>
  );
}
