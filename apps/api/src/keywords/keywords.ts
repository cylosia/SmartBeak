
import { getDb } from '../db';
import type { DomainId } from '@kernel/branded';
import { ValidationError, ErrorCodes } from '@errors';

/**
 * Keyword row returned from the database
 */
export interface KeywordRow {
  id: string;
  domain_id: DomainId;
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
 * Get keyword coverage statistics for a domain.
 * FIX P2-05: domainId parameter is now branded DomainId (prevents IDOR type gap).
 * FIX P2-07: result.rows[0] undefined case is handled explicitly to avoid silent NaN.
 */
export async function keywordCoverageForDomain(domainId: DomainId): Promise<KeywordCoverageResult> {
  const db = getDb();

  // Single query with LEFT JOIN to ensure atomically consistent counts
  const result = await db.raw<{ rows: Array<{ total_keywords: string; covered_keywords: string }> }>(`
    SELECT
      COUNT(DISTINCT k.id) AS total_keywords,
      COUNT(DISTINCT ck.keyword_id) AS covered_keywords
    FROM keywords k
    LEFT JOIN content_keywords ck ON ck.keyword_id = k.id
    WHERE k.domain_id = ?
  `, [domainId]);

  // FIX P2-07: COUNT() without GROUP BY always returns exactly one row even for an
  // empty table, but guard against unexpected empty result sets from driver errors.
  const row = result.rows[0];
  if (!row) {
    return { total_keywords: 0, covered_keywords: 0 };
  }
  return {
    total_keywords: Number(row['total_keywords']),
    covered_keywords: Number(row['covered_keywords']),
  };
}

/**
 * Normalize a keyword phrase for storage and conflict detection.
 * FIX P2-06: NFC normalization ensures that visually identical characters with
 * different Unicode representations (e.g. NFC vs NFD accents) produce the same
 * normalized_phrase, preventing duplicate keywords from bypassing the unique index.
 */
const normalize = (s: string) => s.normalize('NFC').trim().toLowerCase();

/**
 * Maximum allowed phrase length (characters). Enforced before normalization to
 * prevent event-loop blocking from normalize/trim/toLowerCase on large strings.
 * FIX BUG-10: Added length guard; unbounded input can block the Node.js event loop.
 */
const MAX_PHRASE_LENGTH = 500;

/**
 * Upsert a keyword for a domain.
 * FIX P2-05: domain_id is now branded DomainId to surface IDOR gaps at call sites.
 * Callers MUST verify domain ownership before invoking this function.
 * FIX BUG-09: Standardized to bracket notation throughout.
 * FIX BUG-10: Added phrase length validation to prevent event-loop DoS.
 * FIX BUG-11: Added db<KeywordRow> generic so .returning() is typed correctly.
 */
export async function upsertKeyword(input: {
  domain_id: DomainId;
  source?: string;
  phrase: string;
  intent?: string;
}): Promise<KeywordRow | undefined> {
  // FIX BUG-10: Reject phrases that exceed the maximum length before any
  // string processing to avoid O(n) work on arbitrarily large inputs.
  if (input['phrase'].length > MAX_PHRASE_LENGTH) {
    throw new ValidationError(
      `Keyword phrase must not exceed ${MAX_PHRASE_LENGTH} characters`,
      'phrase',
      ErrorCodes.VALIDATION_FAILED,
    );
  }

  const db = getDb();
  const normalized_phrase = normalize(input['phrase']);
  // FIX BUG-11: Typed the query builder with db<KeywordRow>(...) so that
  // .returning() infers KeywordRow[] and rows[0] is KeywordRow | undefined
  // without an unsafe cast. The previous `as KeywordRow | undefined` assertion
  // was applied after indexing into an untyped array.
  const rows = await db<KeywordRow>('keywords')
  .insert({
    domain_id: input['domain_id'],
    phrase: input['phrase'],
    normalized_phrase,
    source: input['source'],
    intent: input['intent'],
  })
  .onConflict(['domain_id', 'normalized_phrase'])
  .merge()
  .returning(['id', 'domain_id', 'phrase', 'normalized_phrase', 'source', 'intent', 'created_at']);
  return rows[0];
}
