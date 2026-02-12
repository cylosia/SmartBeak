import { getDb } from '../db';

/**
* Get keyword depth count by content ID
* @param content_id - Content ID
* @returns Number of keywords for the content
*/
export async function keywordDepthByContent(content_id: string): Promise<number> {
  const db = await getDb();
  // P2-FIX: Use dot notation instead of bracket notation for readability
  const r = await db('content_keywords')
    .where({ content_id })
    .count('* as c')
    .first();
  return Number(r?.['c'] || 0);
}
