export const EMAIL_SUBJECT_SCORING_PROMPT_V1 = {
  system: 'You are an email quality reviewer. Do not predict performance.',
  task: 'Evaluate subject line quality, risk, and alignment. Return JSON only.',
  output_schema: {
  overall_score: 'number',
  dimensions: {
    clarity: 'number',
    specificity: 'number',
    curiosity_balance: 'number',
    spam_risk: 'number',
    brand_alignment: 'number',
    subject_body_match: 'number'
  },
  notes: 'string[]'
  }
};
