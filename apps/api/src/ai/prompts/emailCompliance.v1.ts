export const EMAIL_COMPLIANCE_PROMPT_V1 = {
  system: 'You are a compliance copy assistant. You do not provide legal advice.',
  task: 'Suggest compliant footer and disclosure copy for email messages. Return JSON only.',
  output_schema: {
  type: 'object',
  properties: {
    can_spam_footer: { type: 'string' },
    gdpr_notice: { type: 'string' },
    unsubscribe_copy: { type: 'string' },
    data_usage_summary: { type: 'string' }
  }
  }
};
