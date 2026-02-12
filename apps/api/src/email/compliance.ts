

// Email compliance prompt template
const EMAIL_COMPLIANCE_PROMPT_V1 = `Generate email compliance copy including:
- CAN-SPAM footer requirements
- GDPR notice
- Unsubscribe copy
- Data usage summary`;

/**
* Email compliance context
*/
export interface EmailComplianceContext {
  region?: string;
  industry?: string;
  companyName?: string;
  [key: string]: unknown;
}

/**
* Email compliance copy result
*/
export interface EmailComplianceCopy {
  can_spam_footer: string;
  gdpr_notice: string;
  unsubscribe_copy: string;
  data_usage_summary: string;
}

/**
* RFC 8058 List-Unsubscribe headers required by Gmail/Yahoo (Feb 2024+).
*/
export interface ListUnsubscribeHeaders {
  'List-Unsubscribe': string;
  'List-Unsubscribe-Post': string;
}

/**
* Build RFC 8058 List-Unsubscribe headers for an email.
* @param unsubscribeUrl - HTTPS one-click unsubscribe endpoint
* @param unsubscribeMailto - Optional mailto fallback
*/
export function buildListUnsubscribeHeaders(
  unsubscribeUrl: string,
  unsubscribeMailto?: string
): ListUnsubscribeHeaders {
  const parts: string[] = [];
  if (unsubscribeMailto) {
  parts.push(`<mailto:${unsubscribeMailto}>`);
  }
  parts.push(`<${unsubscribeUrl}>`);

  return {
  'List-Unsubscribe': parts.join(', '),
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
* Generate email compliance copy
* @param context - Compliance context
* @returns Email compliance copy
*/
export async function generateEmailComplianceCopy(
  context: EmailComplianceContext
): Promise<EmailComplianceCopy> {
  // Call LLM with EMAIL_COMPLIANCE_PROMPT_V1 + context
  void EMAIL_COMPLIANCE_PROMPT_V1;
  void context;
  return {
  can_spam_footer:
    'You are receiving this email because you opted in on our website.',
  gdpr_notice:
    'We respect your privacy and process your data in accordance with GDPR.',
  unsubscribe_copy:
    'Unsubscribe at any time by clicking the link below.',
  data_usage_summary:
    'We use your email only to send relevant updates and offers.'
  };
}
