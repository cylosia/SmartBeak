import { getDb } from '../db';

/**
* Keyword coverage result for a domain
*/
export interface KeywordCoverageResult {
  total_keywords: number;
  covered_keywords: number;
}

/**
* Calculate keyword coverage metrics for a domain
* @param domain_id - The domain ID to analyze
* @returns Total and covered keyword counts
*/
export async function keywordCoverageForDomain(
  domain_id: string
): Promise<KeywordCoverageResult> {
  const db = await getDb();
  const total = await db('keywords').where({ domain_id })["count"]('* as c').first();
  const covered = await db('content_keywords')
    .join('keywords', 'keywords.id', 'content_keywords.keyword_id')
    .where('keywords.domain_id', domain_id)
    .countDistinct('keywords.id as c')
    .first();

  return {
    total_keywords: Number(total?.['c'] || 0),
    covered_keywords: Number(covered?.['c'] || 0)
  };
}
