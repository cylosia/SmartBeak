export const LEAD_MAGNET_PROMPT_V1 = {
  system: 'You are an email conversion strategist. You do not send emails.',
  task: 'Propose a lead magnet aligned to the site niche. Return JSON only.',
  // P2-FIX: Add required + additionalProperties to prevent incomplete/polluted output
  output_schema: {
  type: 'object',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    outline: { type: 'array', items: { type: 'string' } },
    positioning: { type: 'string' }
  },
  required: ['type', 'title', 'outline', 'positioning'],
  additionalProperties: false
  }
};
