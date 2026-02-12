
import { getDb } from '../db';

/**
 * Keyword row returned from the database
 * P1-07: Explicit type instead of relying on Knex's `any` inference
 */
export interface KeywordRow {
  id: string;
  domain_id: string;
  phrase: string;
  normalized_phrase: string;
  source: string | null;
  intent: string | null;
  created_at: Date;
}

/**
 * Keyword coverage statistics
 */
export interface KeywordCoverageResult {
  total_keywords: number;
  covered_keywords: number;
}

/**
 * Get keyword coverage statistics for a domain
 * P1-08: Combined into a single query to prevent inconsistent counts
 * @param domainId - The domain ID to check coverage for
 * @returns Keyword coverage statistics
 */
export async function keywordCoverageForDomain(domainId: string): Promise<KeywordCoverageResult> {
  const db = getDb();

  // P1-08: Single query with LEFT JOIN to ensure atomically consistent counts
  const result = await db.raw<{ rows: Array<{ total_keywords: string; covered_keywords: string }> }>(`
    SELECT
      COUNT(DISTINCT k.id) AS total_keywords,
      COUNT(DISTINCT ck.keyword_id) AS covered_keywords
    FROM keywords k
    LEFT JOIN content_keywords ck ON ck.keyword_id = k.id
    WHERE k.domain_id = ?
  `, [domainId]);

  const row = result.rows[0];
  return {
    total_keywords: Number(row?.total_keywords || 0),
    covered_keywords: Number(row?.covered_keywords || 0),
  };
}

const normalize = (s: string) => s.trim().toLowerCase();

/**
 * Upsert a keyword for a domain
 * P1-07: Explicit return type to avoid `any` inference from Knex
 * P2-11: Return specific columns instead of `returning('*')`
 */
export async function upsertKeyword(input: {
  domain_id: string;
  source?: string;
  phrase: string;
  intent?: string;
}): Promise<KeywordRow | undefined> {
  const db = getDb();
  const normalized_phrase = normalize(input.phrase);
  const rows = await db('keywords')
  .insert({
    domain_id: input.domain_id,
    phrase: input.phrase,
    normalized_phrase,
    source: input.source,
    intent: input.intent
  })
  .onConflict(['domain_id', 'normalized_phrase'])
  .merge()
  // P2-11: Return only needed columns instead of '*'
  .returning(['id', 'domain_id', 'phrase', 'normalized_phrase', 'source', 'intent', 'created_at']);
  return rows[0] as KeywordRow | undefined;
}
