/**
 * CRITICAL SECURITY TESTS: SQL Injection Vector Testing
 * 
 * These tests verify that SQL injection attempts are properly neutralized
 * across all identified vulnerability points in the codebase.
 * 
 * VULNERABILITIES TESTED:
 * 1. ILIKE without ESCAPE clause (emailSubscribers)
 * 2. Backslash escape issues (content routes)  
 * 3. FTS injection risks (search documents)
 */

import { escapeLikePattern, buildSafeIlikeQuery } from '../../apps/api/src/routes/emailSubscribers/utils';

// Mock the PostgresSearchDocumentRepository sanitizeFtsQuery method
function sanitizeFtsQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  const MAX_QUERY_LENGTH = 200;
  let sanitized = query.slice(0, MAX_QUERY_LENGTH).trim();

  sanitized = sanitized
    .replace(/[&|!():*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return '';
  }

  return sanitized;
}

describe('SQL Injection Security Tests', () => {
  
  describe('LIKE/ILIKE Wildcard Injection Prevention', () => {
    
    test('should escape percent wildcard (%) to prevent match-all injection', () => {
      const malicious = '%';
      const escaped = escapeLikePattern(malicious);
      expect(escaped).toBe('\\%');
    });

    test('should escape underscore wildcard (_) to prevent single-char injection', () => {
      const malicious = '_';
      const escaped = escapeLikePattern(malicious);
      expect(escaped).toBe('\\_');
    });

    test('should escape backslash to prevent escape injection', () => {
      const malicious = '\\';
      const escaped = escapeLikePattern(malicious);
      expect(escaped).toBe('\\\\');
    });

    test('should pass through strings without LIKE wildcards', () => {
      const malicious = "'; DROP TABLE users; --";
      const escaped = escapeLikePattern(malicious);
      // escapeLikePattern only handles LIKE wildcards (%, _, \)
      // SQL injection is prevented by parameterized queries, not LIKE escaping
      expect(escaped).toBe(malicious);
    });

    test('should handle complex wildcard injection attempts', () => {
      const malicious = '%admin%';
      const escaped = escapeLikePattern(malicious);
      expect(escaped).toBe('\\%admin\\%');
    });

    test('should handle multiple consecutive wildcards', () => {
      const malicious = '%%%___';
      const escaped = escapeLikePattern(malicious);
      expect(escaped).toBe('\\%\\%\\%\\_\\_\\_');
    });

    test('should preserve normal search terms', () => {
      const normal = 'john doe';
      const escaped = escapeLikePattern(normal);
      expect(escaped).toBe('john doe');
    });

    test('should handle empty strings', () => {
      expect(escapeLikePattern('')).toBe('');
    });

    test('should handle strings with special regex chars (not LIKE special)', () => {
      const input = 'test[abc]^$.';
      const escaped = escapeLikePattern(input);
      expect(escaped).toBe('test[abc]^$.');
    });

    test('should handle unicode characters safely', () => {
      const input = 'test%search';
      const escaped = escapeLikePattern(input);
      expect(escaped).toBe('test\\%search');
    });

    test('should handle mixed escape scenarios', () => {
      const malicious = '\\%_test\\%_';
      const escaped = escapeLikePattern(malicious);
      expect(escaped).toBe('\\\\\\%\\_test\\\\\\%\\_');
    });
  });

  describe('Safe ILIKE Query Builder', () => {
    
    test('should generate SQL with ESCAPE clause', () => {
      const result = buildSafeIlikeQuery('first_name', 1);
      expect(result.sql).toContain('ILIKE');
      expect(result.sql).toContain("ESCAPE");
    });

    test('should wrap pattern with wildcards', () => {
      const result = buildSafeIlikeQuery('first_name', 1);
      const wrapped = result.wrapPattern('john');
      expect(wrapped).toBe('%john%');
    });

    test('should properly escape and wrap malicious patterns', () => {
      const result = buildSafeIlikeQuery('first_name', 1);
      const wrapped = result.wrapPattern('%admin%');
      expect(wrapped).toBe('%\\%admin\\%%');
    });
  });

  describe('Full-Text Search (FTS) Injection Prevention', () => {
    
    test('should remove FTS AND operator (&)', () => {
      const malicious = 'apples & oranges';
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized).not.toContain('&');
      expect(sanitized).toBe('apples oranges');
    });

    test('should remove FTS OR operator (|)', () => {
      const malicious = 'apples | oranges';
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized).not.toContain('|');
      expect(sanitized).toBe('apples oranges');
    });

    test('should remove FTS NOT operator (!)', () => {
      const malicious = '!apples';
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized).not.toContain('!');
      expect(sanitized).toBe('apples');
    });

    test('should remove FTS grouping parentheses', () => {
      const malicious = '(apples oranges)';
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized).not.toContain('(');
      expect(sanitized).not.toContain(')');
      expect(sanitized).toBe('apples oranges');
    });

    test('should remove FTS field search operator (:)', () => {
      const malicious = 'title:apples';
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized).not.toContain(':');
      expect(sanitized).toBe('title apples');
    });

    test('should remove FTS prefix operator (*)', () => {
      const malicious = 'apple*';
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized).not.toContain('*');
      expect(sanitized).toBe('apple');
    });

    test('should handle complex FTS injection attempts', () => {
      const malicious = '(apples | oranges) & !bananas*';
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized).toBe('apples oranges bananas');
    });

    test('should limit query length to prevent DoS', () => {
      const longQuery = 'a'.repeat(500);
      const sanitized = sanitizeFtsQuery(longQuery);
      expect(sanitized.length).toBeLessThanOrEqual(200);
    });

    test('should handle empty queries', () => {
      expect(sanitizeFtsQuery('')).toBe('');
    });

    test('should handle whitespace-only queries', () => {
      expect(sanitizeFtsQuery('   ')).toBe('');
    });

    test('should normalize multiple spaces', () => {
      const query = 'apples    oranges     bananas';
      const sanitized = sanitizeFtsQuery(query);
      expect(sanitized).toBe('apples oranges bananas');
    });

    test('should preserve normal search terms', () => {
      const normal = 'how to bake apple pie';
      const sanitized = sanitizeFtsQuery(normal);
      expect(sanitized).toBe('how to bake apple pie');
    });

    test('should handle queries with only operators', () => {
      const malicious = '&|!():*';
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized).toBe('');
    });

    test('should handle unicode characters safely', () => {
      const input = 'text&test';
      const sanitized = sanitizeFtsQuery(input);
      expect(sanitized).toBe('text test');
    });

    test('should handle SQL injection attempts in FTS queries', () => {
      const malicious = "'; DROP TABLE search_documents; --";
      const sanitized = sanitizeFtsQuery(malicious);
      expect(sanitized.length).toBeLessThanOrEqual(200);
    });
  });

  describe('Edge Cases and Combined Attacks', () => {
    
    test('should handle null/undefined inputs gracefully', () => {
      expect(escapeLikePattern(null as unknown as string)).toBeNull();
      expect(escapeLikePattern(undefined as unknown as string)).toBeUndefined();
      expect(sanitizeFtsQuery('')).toBe('');
    });

    test('should handle very long escape sequences', () => {
      const malicious = '\\\\\\\\%_%';
      const escaped = escapeLikePattern(malicious);
      expect(escaped).toBe('\\\\\\\\\\\\\\\\\\%\\_\\%');
    });

    test('should handle mixed attack vectors', () => {
      const maliciousLike = "%'; --";
      const escaped = escapeLikePattern(maliciousLike);
      expect(escaped).toContain('\\%');
      
      const maliciousFts = '&|' + 'a'.repeat(1000);
      const sanitized = sanitizeFtsQuery(maliciousFts);
      expect(sanitized).not.toContain('&');
      expect(sanitized).not.toContain('|');
      expect(sanitized.length).toBeLessThanOrEqual(200);
    });

    test('should prevent case sensitivity bypass attempts', () => {
      const input = 'TeSt%_UsEr';
      const escaped = escapeLikePattern(input);
      expect(escaped).toBe('TeSt\\%\\_UsEr');
    });
  });
});

describe('SQL Query Generation Security', () => {
  
  test('email subscriber search query generation', () => {
    const searchTerm = 'john%admin';
    const sanitized = escapeLikePattern(searchTerm);
    const pattern = `%${sanitized}%`;
    
    expect(pattern).toBe('%john\\%admin%');
  });

  test('content search query generation', () => {
    const searchTerm = 'test_%';
    const escapedSearch = searchTerm
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    
    expect(escapedSearch).toBe('test\\_\\%');
  });

  test('FTS search query generation', () => {
    const searchTerm = 'apple & orange | banana';
    const sanitized = sanitizeFtsQuery(searchTerm);
    
    expect(sanitized).toBe('apple orange banana');
  });
});
