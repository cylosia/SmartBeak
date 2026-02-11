export const EMAIL_SEQUENCE_PROMPT_V1 = {
  system: 'You are an email strategist. You do not send emails.',
  task: 'Draft an autoresponder sequence outline. Return JSON only.',
  output_schema: {
  type: 'object',
  properties: {
    sequence_goal: { type: 'string' },
    emails: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
      subject: { type: 'string' },
      theme: { type: 'string' },
      delay_days: { type: 'number' }
      }
    }
    }
  }
  }
};
