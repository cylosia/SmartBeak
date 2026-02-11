# SQL Injection Vulnerability Analysis and Fixes

## Executive Summary

This document details three critical SQL injection vulnerabilities that were identified and fixed in the codebase. Each vulnerability is analyzed with the attack vector, impact assessment, and the implemented fix.

---

## VULNERABILITY #1: ILIKE Without ESCAPE Clause

### Location
- **File**: `apps/api/src/routes/emailSubscribers/index.ts`
- **Lines**: 110-111

### Vulnerable Code (Before Fix)
```typescript
.orWhereRaw('first_name ILIKE ?', [`%${sanitizedSearch}%`])
```

### Attack Vector
The `sanitizeString()` function only removes `<>` characters and truncates, but does NOT escape SQL LIKE wildcards (`%` and `_`). This allows attackers to:

1. **Wildcard Injection**: Use `%` to match all records
   - Search: `%` → Matches every first_name
   
2. **Character Wildcard**: Use `_` to perform single-character enumeration
   - Search: `a___` → Matches all 4-letter names starting with 'a'

3. **Combined with partial known data**: 
   - Search: `%admin%` → Finds any name containing "admin"

### Impact
- **Severity**: HIGH
- **Data Exposure**: Unauthorized access to subscriber data
- **Privacy Violation**: Potential enumeration of all subscribers

### Fix Applied

#### 1. Added `escapeLikePattern()` utility function (`utils.ts`)
```typescript
export function escapeLikePattern(pattern: string, escapeChar: string = '\\'): string {
  if (!pattern) return pattern;
  
  // Escape special LIKE characters: %, _, and the escape char itself
  return pattern
    .replace(/\\/g, escapeChar + escapeChar)  // Escape backslashes first
    .replace(/%/g, escapeChar + '%')          // Escape percent wildcards
    .replace(/_/g, escapeChar + '_');         // Escape underscore wildcards
}
```

#### 2. Modified query to use ESCAPE clause (`index.ts`)
```typescript
const escapedSearch = escapeLikePattern(sanitizedSearch);
query = query.where(function() {
  this.where('email_hash', hashEmail(sanitizedSearch))
    .orWhereRaw('first_name ILIKE ? ESCAPE \\', [`%${escapedSearch}%`])
    .orWhereRaw('last_name ILIKE ? ESCAPE \\', [`%${escapedSearch}%`]);
});
```

### Why This Fix Works
- **ESCAPE clause**: Explicitly tells PostgreSQL to treat `\` as the escape character
- **Proper escaping**: All special LIKE characters (`%`, `_`, `\`) are escaped
- **Maintains functionality**: Users can still search for literal `%` or `_` in names

---

## VULNERABILITY #2: Backslash Escape Issue

### Location
- **File**: `control-plane/api/routes/content.ts`
- **Line**: 169

### Vulnerable Code (Before Fix)
```typescript
const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
query += ` AND (c.title ILIKE $${paramIndex} OR c.body ILIKE $${paramIndex})`;
```

### Attack Vector
The original code attempted to escape LIKE wildcards but had critical flaws:

1. **No ESCAPE clause**: The SQL query doesn't specify `ESCAPE '\'`, meaning:
   - In standard SQL, `\` has no special meaning without ESCAPE
   - Database may treat `\%` literally instead of as escaped percent
   - Behavior varies by database configuration

2. **Double-escape risk**: If a user sends `\%`:
   - Code converts it to `\\%`
   - Without ESCAPE clause, this may still be interpreted as wildcard

3. **Backslash injection**: If the database has `standard_conforming_strings=off`:
   - Backslashes may be interpreted as string escapes
   - Could lead to string termination and SQL injection

### Impact
- **Severity**: HIGH
- **Unpredictable behavior**: Different PostgreSQL configurations behave differently
- **Potential SQL injection**: With certain database settings

### Fix Applied
```typescript
if (search) {
  // P1-SECURITY-FIX: Escape LIKE wildcards and use ESCAPE clause
  const escapedSearch = search
    .replace(/\\/g, '\\\\')   // Escape backslashes first
    .replace(/%/g, '\\%')     // Escape percent wildcards  
    .replace(/_/g, '\\_');    // Escape underscore wildcards
  query += ` AND (c.title ILIKE $${paramIndex} ESCAPE '\\' OR c.body ILIKE $${paramIndex} ESCAPE '\\')`;
  params.push(`%${escapedSearch}%`);
  paramIndex++;
}
```

### Key Improvements
1. **Explicit ESCAPE clause**: `ESCAPE '\'` ensures consistent behavior
2. **Correct escape order**: Backslashes escaped first to prevent double-escaping
3. **Consistent pattern**: Same approach used across all ILIKE queries

---

## VULNERABILITY #3: FTS Injection Risk

### Location
- **File**: `domains/search/infra/persistence/PostgresSearchDocumentRepository.ts`
- **Lines**: 79-85

### Vulnerable Code (Before Fix)
```typescript
async search(query: string, limit = 20): Promise<SearchResultRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const { rows } = await this.pool.query(`SELECT ... 
    WHERE tsv_weighted @@ plainto_tsquery('english', $1)
    ...`, [query, safeLimit]);
  return rows as SearchResultRow[];
}
```

### Attack Vector
While `plainto_tsquery()` is safer than `to_tsquery()`, it still has issues:

1. **Query manipulation with FTS operators**:
   - `apples & oranges` → Requires both words (AND logic)
   - `apples | oranges` → Either word (OR logic)
   - `!apples` → Exclude word (NOT logic)
   - `apple*` → Prefix matching
   - `(apples oranges)` → Grouping

2. **DoS via query length**:
   - No length limit on query parameter
   - Could submit megabytes of text
   - PostgreSQL FTS has limits that could cause errors

3. **Information disclosure**:
   - Complex queries could be used to probe index structure
   - Error messages might reveal schema information

### Impact
- **Severity**: MEDIUM-HIGH
- **Query manipulation**: Users can alter search logic
- **DoS potential**: No input limits
- **Unexpected results**: Boolean operators change search semantics

### Fix Applied

#### Added `sanitizeFtsQuery()` method:
```typescript
private sanitizeFtsQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Limit query length to prevent DoS
  const MAX_QUERY_LENGTH = 200;
  let sanitized = query.slice(0, MAX_QUERY_LENGTH).trim();

  // Remove FTS operators that could alter query behavior
  sanitized = sanitized
    .replace(/[&|!():*]/g, ' ')     // Remove FTS operators
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .trim();

  if (!sanitized) {
    return '';
  }

  return sanitized;
}
```

#### Modified `search()` method to use sanitization:
```typescript
async search(query: string, limit = 20): Promise<SearchResultRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  
  // SECURITY FIX: Sanitize FTS query
  const sanitizedQuery = this.sanitizeFtsQuery(query);
  
  const { rows } = await this.pool.query(`...
    WHERE tsv_weighted @@ plainto_tsquery('english', $1)
    ...`, [sanitizedQuery, safeLimit]);
  // ...
}
```

### Why This Fix Works
- **Operator removal**: Strips all FTS operators that modify search behavior
- **Length limiting**: Prevents DoS from oversized queries
- **Whitespace normalization**: Prevents edge cases with unusual spacing
- **Maintains functionality**: Simple word searches work as expected

---

## Test Coverage

Comprehensive tests have been added in `test/security/sql-injection.test.ts` covering:

### LIKE/ILIKE Tests
- Percent wildcard (`%`) escaping
- Underscore wildcard (`_`) escaping
- Backslash escaping
- SQL comment injection attempts
- Complex wildcard combinations
- Unicode character handling

### FTS Tests
- AND operator (`&`) removal
- OR operator (`|`) removal
- NOT operator (`!`) removal
- Grouping parentheses removal
- Field search (`:`) removal
- Prefix operator (`*`) removal
- Query length limiting
- Normalization of whitespace

### Edge Cases
- Null/undefined inputs
- Empty strings
- Very long inputs
- Mixed attack vectors
- Unicode and special characters

---

## Verification

To run the security tests:

```bash
# Run all security tests
npm test -- test/security/sql-injection.test.ts

# Run with coverage
npm test -- --coverage test/security/sql-injection.test.ts
```

---

## Prevention Guidelines

For future development, follow these SQL security practices:

1. **Always use ESCAPE clause** with LIKE/ILIKE queries
2. **Escape all special characters**: `%`, `_`, and the escape character itself
3. **Never trust user input** for FTS queries - sanitize or use safe functions
4. **Limit input length** for all query parameters
5. **Use parameterized queries** exclusively (no string concatenation)
6. **Add security tests** for any new search functionality

---

## Files Modified

1. `apps/api/src/routes/emailSubscribers/utils.ts` - Added escape functions
2. `apps/api/src/routes/emailSubscribers/index.ts` - Fixed ILIKE queries
3. `control-plane/api/routes/content.ts` - Fixed ILIKE queries with ESCAPE
4. `domains/search/infra/persistence/PostgresSearchDocumentRepository.ts` - Added FTS sanitization
5. `test/security/sql-injection.test.ts` - New comprehensive test suite
6. `test/security/SQL_INJECTION_VECTORS.md` - This documentation
