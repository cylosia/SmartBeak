import { getDb } from '../db';

/**
* Get keyword depth count by content ID
* @param content_id - Content ID
* @returns Number of keywords for the content
*/
export async function keywordDepthByContent(content_id: string): Promise<number> {
  // P2-AUDIT-FIX: Validate content_id to avoid wasteful empty/oversized DB queries
  if (!content_id || typeof content_id !== 'string' || content_id.length > 255) {
    throw new Error('Invalid content_id: must be a non-empty string of at most 255 characters');
  }
  const db = getDb(); // P3-FIX: getDb() is synchronous, await was a no-op
  // P2-FIX: Use dot notation instead of bracket notation for readability
  const r = await db('content_keywords')
    .where({ content_id })
    .count('* as c')
    .first();
  return Number(r?.['c'] || 0);
}
