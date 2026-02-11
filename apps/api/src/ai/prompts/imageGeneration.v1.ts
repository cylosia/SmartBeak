export const IMAGE_GENERATION_PROMPT_V1 = {
  system: 'You are a visual designer. Do not generate copyrighted characters.',
  task: 'Generate an image prompt only. Return JSON.',
  output_schema: {
  concept: 'string',
  style: 'string',
  aspect_ratio: 'string',
  usage: 'string'
  }
};
