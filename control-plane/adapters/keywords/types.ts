import { z } from 'zod';

export type KeywordMetrics = {
  search_volume?: number;
  competition?: number; // 0.0–1.0
  cpc?: number;         // cost-per-click in USD cents
  trend?: 'up' | 'down' | 'stable';
};

export type KeywordSuggestion = {
  keyword: string;
  metrics?: KeywordMetrics;
};

/**
 * FIXED (KEYWORDS-1): Zod schema for validating external keyword adapter responses.
 * Must be used at the service layer when consuming KeywordIngestionAdapter.fetch() results.
 * Enforces max length and safe character set to prevent stored XSS or injection via
 * keywords returned by a compromised or MITM-attacked external provider.
 *
 * FIXED (KEYWORDS-UNICODE): Added refine() to strip invisible Unicode characters.
 * \p{L} (Unicode letters) includes invisible/zero-width characters:
 *   U+200B (Zero-Width Space), U+200C (ZWNJ), U+200D (ZWJ), U+200F (RLM),
 *   U+00AD (Soft Hyphen), U+202A-U+202E (bidirectional overrides)
 * These can be used for Unicode homograph/spoofing attacks when keywords are displayed.
 */
const INVISIBLE_UNICODE_RE = /[\u200B-\u200F\u202A-\u202E\u00AD\uFEFF]/;

export const KeywordSuggestionSchema = z.object({
  keyword: z.string().min(1).max(500)
    .regex(/^[\p{L}\p{N}\s\-'.]+$/u, 'Keyword contains invalid characters')
    .refine(
      (s) => !INVISIBLE_UNICODE_RE.test(s),
      'Keyword contains invisible Unicode characters'
    ),
  metrics: z.object({
    search_volume: z.number().nonnegative().optional(),
    competition: z.number().min(0).max(1).optional(),
    cpc: z.number().nonnegative().optional(),
    trend: z.enum(['up', 'down', 'stable']).optional(),
  }).optional(),
});

export interface KeywordIngestionAdapter {
  source: string;
  /**
   * FIXED (KEYWORDS-3): The `domain` parameter MUST be validated as a well-formed
   * domain name by callers before being passed here, to prevent SSRF or HTTP header
   * injection via URL construction in adapter implementations.
   * Callers should validate: /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/
   */
  fetch(domain: string): Promise<KeywordSuggestion[]>;
}
