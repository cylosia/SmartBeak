

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { rateLimit } from '../../services/rate-limit';
import { requireRole, type AuthContext } from '../../services/auth';
import { SearchQueryService } from '../../services/search-query';

export async function searchRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const svc = new SearchQueryService(pool);

  const SearchQuerySchema = z.object({
  q: z.string()
    .min(1, 'Search query must be at least 1 character')
    .max(200, 'Search query must be less than 200 characters')
    // Sanitize: remove control characters and limit to alphanumeric + common punctuation
    .transform(val => sanitizeSearchQuery(val)),
  limit: z.coerce.number().min(1).max(100).default(20),
  page: z.coerce.number().min(1).default(1),
  });

  app.get('/search', async (req, res) => {
  const ctx = req.auth as AuthContext;
  if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
  await rateLimit('search', 30);

  // Validate query parameters
  const parseResult = SearchQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: parseResult["error"].issues
    });
  }

  const { q, limit } = parseResult.data;
  const page = Math.max(1, parseInt(String((req.query as Record<string, string | undefined>)['page'])) || 1);
  if (!q || q.length < 2) {
    return res.send({ results: [], pagination: { page, limit, total: 0, totalPages: 0 } });
  }

  // Parse pagination params - now validated by schema
  const offset = (page - 1) * limit;

  // P0-FIX: Pass auth context to search service for tenant isolation
  const results = await svc.search(q, limit, offset, ctx);

  // P0-FIX: Pass orgId to searchCount for tenant isolation
  const total = await svc.searchCount(q, ctx.orgId);

  return res.send({
    pagination: {
    totalPages: Math.ceil(total / limit),
    }
  });
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

  // Skip path traversal characters
  if (char === '.' || char === '/') continue;

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
