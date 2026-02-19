
import { getDb } from '../db';
import type { DomainId, KeywordId } from '@kernel/branded';
import { ValidationError, ErrorCodes } from '@errors';

/**
 * Keyword row returned from the database
 */
export interface KeywordRow {
  id: KeywordId;
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
 * FIX: Use locale-pinned toLocaleLowerCase('en-US') to prevent Turkish-I and similar
 * locale-dependent case-folding issues that would break the unique index in non-en envs.
 */
const normalize = (s: string) => s.normalize('NFC').trim().toLocaleLowerCase('en-US');

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
      ErrorCodes.VALIDATION_ERROR,
    );
  }

  const db = getDb();
  const normalized_phrase = normalize(input['phrase']);
  // FIX: Use raw SQL upsert with COALESCE so that a caller omitting `source` or
  // `intent` (undefined → NULL) does NOT overwrite an existing non-null value.
  // Knex's .merge() with no args or a column list cannot express this without raw SQL.
  const result = await db.raw<{ rows: KeywordRow[] }>(`
    INSERT INTO keywords (domain_id, phrase, normalized_phrase, source, intent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (domain_id, normalized_phrase) DO UPDATE SET
      phrase     = EXCLUDED.phrase,
      source     = COALESCE(EXCLUDED.source, keywords.source),
      intent     = COALESCE(EXCLUDED.intent, keywords.intent)
    RETURNING id, domain_id, phrase, normalized_phrase, source, intent, created_at
  `, [
    input['domain_id'],
    input['phrase'],
    normalized_phrase,
    input['source'] ?? null,
    input['intent'] ?? null,
  ]);
  return result.rows[0];
}
