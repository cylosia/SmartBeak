
import React from 'react';

import { EmailComplianceHelper } from './EmailComplianceHelper';
export function EmailMessageEditor({ message, compliance }: any) {
  return (
  <div>
    <h3>Edit Email Message</h3>
    <input value={message.subject} readOnly />
    <textarea value={message.body} readOnly />
    <EmailComplianceHelper compliance={compliance} />
  </div>
  );
}
