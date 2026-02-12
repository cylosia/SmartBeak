/**
* Sanitize text for safe use in tsvector/tsquery
* Removes control characters and tsquery special chars that could cause issues
*/
function sanitizeForTS(text: string): string {
  if (!text || typeof text !== 'string') {
  return '';
  }
  // Remove null bytes and control characters
  // eslint-disable-next-line no-control-regex
  let sanitized = text.replace(/[\x00-\x1F\x7F]/g, '');
  // Remove PostgreSQL tsquery special characters to prevent query syntax errors
  // These are: & (AND), | (OR), ! (NOT), ( ) (grouping), : (followed by weight)
  sanitized = sanitized.replace(/[&|!():]/g, ' ');
  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  // Limit length to prevent excessive memory usage
  return sanitized.substring(0, 10000);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildWeightedTSVector(fields: Record<string, any>) {
  const rawTitle = typeof fields["title"] === 'string' ? fields["title"] : '';
  const rawBody = typeof fields["body"] === 'string' ? fields["body"] : '';
  return {
  title: sanitizeForTS(rawTitle),
  body: sanitizeForTS(rawBody)
  };
}

/**
* Sanitize a user search query for safe use with PostgreSQL full-text search
* Prevents tsquery syntax errors and potential injection
*/
export function sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
  return '';
  }
  // Remove null bytes and control characters
  // eslint-disable-next-line no-control-regex
  let sanitized = query.replace(/[\x00-\x1F\x7F]/g, '');
  // Replace tsquery special characters with spaces to prevent syntax errors
  // & (AND), | (OR), ! (NOT), ( ) (grouping)
  sanitized = sanitized.replace(/[&|!()]/g, ' ');
  // Handle colons carefully - they can be used for weights but remove if problematic
  sanitized = sanitized.replace(/:\s*/g, ' ');
  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  // Limit length
  return sanitized.substring(0, 255);
}
