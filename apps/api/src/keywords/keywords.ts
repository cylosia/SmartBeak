
import { getDb } from '../db';

/**
 * Get keyword coverage statistics for a domain
 * @param domainId - The domain ID to check coverage for
 * @returns Keyword coverage statistics
 */
export async function keywordCoverageForDomain(domainId: string): Promise<{ total_keywords: number; covered_keywords: number }> {
  const db = await getDb();
  
  const totalResult = await db('keywords')
    .where({ domain_id: domainId })
    .count('* as count')
    .first();
  
  const coveredResult = await db('content_keywords')
    .join('keywords', 'content_keywords.keyword_id', 'keywords.id')
    .where('keywords.domain_id', domainId)
    .countDistinct('keywords.id as count')
    .first();
  
  return {
    total_keywords: Number(totalResult?.['count'] || 0),
    covered_keywords: Number(coveredResult?.['count'] || 0),
  };
}

const normalize = (s: string) => s.trim().toLowerCase();

export async function upsertKeyword(input: {
  domain_id: string;
  source?: string;
  phrase: string;
  intent?: string;
}) {
  const db = await getDb();
  const normalized_phrase = normalize(input.phrase);
  const [row] = await db('keywords')
  .insert({
    domain_id: input.domain_id,
    phrase: input.phrase,
    normalized_phrase,
    source: input.source,
    intent: input.intent
  })
  .onConflict(['domain_id', 'normalized_phrase'])
  .merge()
  .returning('*');
  return row;
}
