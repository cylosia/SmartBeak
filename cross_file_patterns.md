# Cross-File Pattern Registry

## Purpose
Track patterns, duplications, and inconsistencies across all "a" files for consolidation recommendations.

---

## 1. Duplicate Function Implementations

### verifyToken()
| File | Lines | Implementation | Notes |
|------|-------|----------------|-------|

### generateRequestId()
| File | Lines | Implementation | Notes |
|------|-------|----------------|-------|

### validateUUID()
| File | Lines | Implementation | Notes |
|------|-------|----------------|-------|

### sanitizeError()
| File | Lines | Implementation | Notes |
|------|-------|----------------|-------|

### Database Connection Getters
| File | Lines | Pattern | Notes |
|------|-------|---------|-------|

---

## 2. Type Assertions Audit

| File | Line | Pattern | Source | Risk Level | Notes |
|------|------|---------|--------|------------|-------|

**Risk Classification:**
- **Safe**: Has type guard or Zod validation
- **Medium**: Defensive checks present
- **High**: No runtime validation

---

## 3. Error Code & Status Code Registry

### HTTP Status Codes by Error Type

| File | Line | Error Message | Status Code | Retryable | Notes |
|------|------|---------------|-------------|-----------|-------|

**Status Code Semantics:**
- **401**: Authentication failure (missing/invalid token) - NOT retryable
- **403**: Authorization failure (valid token, insufficient permissions) - NOT retryable
- **400**: Validation errors - NOT retryable
- **404**: Resource not found - NOT retryable
- **409**: Conflict (duplicate resource) - NOT retryable
- **429**: Rate limit exceeded - RETRYABLE (with exponential backoff + Retry-After)
- **500**: Internal server error - RETRYABLE (with caution)
- **503**: Service unavailable - RETRYABLE

---

## 4. Logger Usage Patterns

### Structured Logger Usage
| File | Pattern | Compliant | Notes |
|------|---------|-----------|-------|

### Console.log Violations
| File | Line | Type | Recommendation |
|------|------|------|----------------|

---

## 5. Security Pattern Registry

### Timing-Safe Comparison Usage
| File | Line | Context | Implementation | Correct |
|------|------|---------|----------------|---------|

### IDOR Protection Patterns
| File | Line | Resource | Verification Method | Compliant |
|------|------|----------|---------------------|-----------|

### JWT Verification Patterns
| File | Line | Key Rotation Support | Clock Tolerance | Validation |
|------|------|---------------------|-----------------|------------|

### Role Enforcement Patterns
| File | Line | Silent Fallback | Explicit Rejection | Compliant |
|------|------|-----------------|-------------------|-----------|

---

## 6. Database Query Patterns

### Parameterized Query Usage
| File | Line | Query Type | Parameterized | SQL Injection Risk |
|------|------|------------|---------------|-------------------|

### N+1 Query Candidates
| File | Line | Loop Context | Query Pattern | Recommendation |
|------|------|--------------|---------------|----------------|

### Transaction Usage
| File | Line | Operation | Transaction Wrapped | Rollback Handled |
|------|------|-----------|---------------------|------------------|

---

## 7. Async/Concurrency Patterns

### AbortController Usage
| File | Line | Timeout Value | Cleanup in Finally | Compliant |
|------|------|---------------|-------------------|-----------|

### Retry Logic Configurations
| File | Line | Max Retries | Backoff Strategy | Jitter | Compliant |
|------|------|-------------|------------------|--------|-----------|

### Promise Handling
| File | Line | Promise Type | Awaited/Caught | Risk |
|------|------|--------------|----------------|------|

---

## Summary Statistics

- **Total files audited**: TBD
- **Duplicate functions found**: TBD
- **Type assertions flagged**: TBD
- **Security patterns verified**: TBD
- **Database query issues**: TBD
- **Async/concurrency issues**: TBD

**Last updated**: 2026-02-12
