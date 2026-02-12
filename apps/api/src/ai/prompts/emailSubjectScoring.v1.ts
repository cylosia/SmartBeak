export const EMAIL_SUBJECT_SCORING_PROMPT_V1 = {
  system: 'You are an email quality reviewer. Do not predict performance.',
  task: 'Evaluate subject line quality, risk, and alignment. Return JSON only.',
  // P2-TYPE FIX: Use JSON Schema format consistent with emailCompliance.v1.ts and emailSequence.v1.ts
  output_schema: {
  overall_score: { type: 'number' },
  dimensions: {
    type: 'object',
    properties: {
      clarity: { type: 'number' },
      specificity: { type: 'number' },
      curiosity_balance: { type: 'number' },
      spam_risk: { type: 'number' },
      brand_alignment: { type: 'number' },
      subject_body_match: { type: 'number' },
    },
  },
  notes: { type: 'array', items: { type: 'string' } },
  }
};
