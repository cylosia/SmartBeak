

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { getAuthContext } from '../types';
import { SearchQueryService } from '../../services/search-query';
import { errors } from '@errors/responses';

const logger = getLogger('search-routes');

export async function searchRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const svc = new SearchQueryService(pool);

  // P2-FIX: Added .strict() — without it, extra query parameters are silently ignored,
  // masking client bugs. Note: .strict() on Zod query-param schemas rejects unknown keys.
  const SearchQuerySchema = z.object({
  q: z.string()
    .min(1, 'Search query must be at least 1 character')
    .max(200, 'Search query must be less than 200 characters')
    // Sanitize: remove control characters and limit to alphanumeric + common punctuation
    .transform(val => sanitizeSearchQuery(val)),
  limit: z.coerce.number().min(1).max(100).default(20),
  page: z.coerce.number().min(1).default(1),
  }).strict();

  app.get('/search', async (req, res) => {
  try {
    await rateLimit('search', 30);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

    // Validate query parameters
    const parseResult = SearchQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return errors.validationFailed(res, parseResult["error"].issues);
    }

    const { q, limit, page } = parseResult.data;
    if (!q || q.length < 2) {
      return res.send({ results: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    }

    const offset = (page - 1) * limit;

    const [results, total] = await Promise.all([
      svc.search(q, limit, offset, ctx),
      svc.searchCount(q, ctx.orgId),
    ]);

    return res.send({
      results,
      pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('[search] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });
}

/**
* SECURITY FIX: Sanitize search query to prevent injection attacks
*
* This implementation uses a single-pass character-based approach instead of
* multiple regex replacements to prevent ReDoS (Regular Expression Denial of Service)
* vulnerabilities that can be exploited with specially crafted input strings.
*/
function sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
  return '';
  }

  const result: string[] = [];
  const length = Math.min(query.length, 200); // Early limit check

  // SQL keywords to filter (checked as whole words)
  const sqlKeywords = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE',
  'ALTER', 'EXEC', 'EXECUTE', 'UNION', 'TABLE', 'DATABASE'
  ]);

  // JavaScript protocol prefix to filter
  const JS_PROTOCOL = 'javascript:';

  // Build sanitized result character by character (single-pass, no regex backtracking)
  for (let i = 0; i < length; i++) {
  const char = query[i]!;
  const charCode = char.charCodeAt(0);

  // Skip control characters (null bytes, etc.)
  if (charCode <= 0x1F || charCode === 0x7F) continue;

  // Skip HTML tag brackets
  if (char === '<' || char === '>') continue;

  // P1-FIX: Removed '.' and '/' from the blocklist. These characters are legitimate
  // in search queries (e.g. "example.com", "v1/api/auth", "node.js") and removing them
  // silently corrupts user input. SQL injection protection is provided by parameterised
  // queries — character removal here adds no security benefit for those chars.

  // Skip SQL comment sequences (--)
  if (char === '-' && result.length > 0 && result[result.length - 1] === '-') {
    result.pop(); // Remove the previous dash
    continue;
  }

  // Skip block comment markers (/* and */)
  if (char === '*') {
    const prevChar = result.length > 0 ? result[result.length - 1] : '';
    const nextChar = i < length - 1 ? query[i + 1] : '';
    if (prevChar === '/' || nextChar === '/') {
    continue;
    }
  }

  result.push(char);
  }

  // Join and convert to lowercase for keyword check
  let sanitized = result.join('');

  // Check for SQL keywords using simple string operations (no regex with backtracking)
  const words = sanitized.split(/\s+/);
  const filteredWords = words.filter(word => {
  const upperWord = word.toUpperCase();
  return !sqlKeywords.has(upperWord);
  });

  sanitized = filteredWords.join(' ');

  // Check for javascript: protocol (case-insensitive, no regex)
  const lowerSanitized = sanitized.toLowerCase();
  if (lowerSanitized.includes(JS_PROTOCOL)) {
  // Use simple string replacement instead of regex
  sanitized = sanitized.split(/javascript:/gi).join('');
  }

  // Check for event handlers (on* = patterns) using simple parsing
  const tokens = sanitized.split(/\s+/);
  const filteredTokens = tokens.filter(token => {
  const lowerToken = token.toLowerCase().trim();
  // Check for onX = pattern (e.g., onclick=, onload=)
  if (lowerToken.startsWith('on') && lowerToken.includes('=')) {
    // Check if it looks like an event handler
    const beforeEquals = lowerToken.split('=')[0]!;
    // Simple heuristic: on followed by 2+ letters is likely an event handler
    if (beforeEquals.length > 2 && /^on[a-z]{2,}$/.test(beforeEquals)) {
    return false;
    }
  }
  return true;
  });

  sanitized = filteredTokens.join(' ');

  // Remove excessive whitespace and normalize
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized;
}
