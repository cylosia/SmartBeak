# P1 Type Safety Fixes Documentation

This document describes the P1 TypeScript type safety improvements applied to the codebase.

## Summary

| Issue | File | Line | Description | Fix |
|-------|------|------|-------------|-----|
| 1 | `pagination.ts` | 226 | Unsafe array access with `!` | Added bounds check before access |
| 2 | `pagination.ts` | 331 | Bigint serialization risk | Use string for bigint, handle overflow |
| 3 | `transactions/index.ts` | 196 | Unsafe indexed access | Remove non-null assertion |
| 4 | `fetchWithRetry.ts` | 139 | Implicit any via predicate | Add proper existence check |
| 5 | `transactions/index.ts` | 119 | Missing return type | Add explicit return type |
| 6 | `billingStripe.ts` | 191 | Bracket notation bypass | Use dot notation |
| 7 | `billingInvoiceExport.ts` | 88 | Double assertion chain | Use type guard |
| 8 | `transactions/index.ts` | 242 | Generic covariance | Add proper constraints |
| 9 | `domainExportJob.ts` | 269 | Missing exhaustiveness | Add assertNever |

---

## Detailed Fixes

### 1. Unsafe Array Access with `!`

**File:** `packages/database/query-optimization/pagination.ts:226`

**Problem:** Using non-null assertion (`!`) on array element access can cause runtime errors if the array is empty.

```typescript
// BEFORE (unsafe)
const nextCursor = hasNext && data.length > 0
  ? encodeCursor(String(data[data.length - 1]![cursorColumn]))
  : null;
```

**Solution:** Add explicit bounds check and property existence check.

```typescript
// AFTER (safe)
const lastRow = data.length > 0 ? data[data.length - 1] : undefined;
const nextCursor = hasNext && lastRow !== undefined && cursorColumn in lastRow
  ? encodeCursor(String(lastRow[cursorColumn]))
  : null;
```

**Benefits:**
- Prevents runtime errors on empty arrays
- Validates property existence before access
- Clearer intent and easier to debug

---

### 2. Bigint Serialization Risk

**File:** `packages/database/query-optimization/pagination.ts:331`

**Problem:** Direct `parseInt` on bigint values can cause precision loss or overflow.

```typescript
// BEFORE (unsafe)
return parseInt(result.rows[0].count as string, 10);
```

**Solution:** Handle bigint as string with overflow protection.

```typescript
// AFTER (safe)
const countValue = result.rows[0]?.count;
if (countValue === undefined || countValue === null) {
  return 0;
}
const countStr = String(countValue);
const countNum = Number(countStr);
if (countNum > Number.MAX_SAFE_INTEGER) {
  return Number.MAX_SAFE_INTEGER;
}
return countNum;
```

**Benefits:**
- Handles bigint values safely as strings
- Prevents integer overflow
- Graceful handling of null/undefined

---

### 3. Unsafe Indexed Access

**File:** `packages/database/transactions/index.ts:196`

**Problem:** Non-null assertion on array element in loop.

```typescript
// BEFORE (unsafe)
const condition = conditions[i]!;
```

**Solution:** Remove non-null assertion with explicit check.

```typescript
// AFTER (safe)
const condition = conditions[i];
if (!condition) continue;
```

**Benefits:**
- Prevents undefined access
- Defensive programming pattern
- Type-safe iteration

---

### 4. Implicit Any via Predicate

**File:** `packages/utils/fetchWithRetry.ts:139`

**Problem:** Non-null assertion bypasses type checking on optional arrays.

```typescript
// BEFORE (unsafe)
return options.retryableStatuses!.includes(error.status);
```

**Solution:** Use proper existence check with fallback.

```typescript
// AFTER (safe)
const statuses = options.retryableStatuses ?? DEFAULT_RETRY_OPTIONS.retryableStatuses;
if (statuses !== undefined && statuses.includes(error.status)) {
  return true;
}
```

**Benefits:**
- No implicit any types
- Defensive fallback to defaults
- Explicit null/undefined handling

---

### 5. Missing Return Type

**File:** `packages/database/transactions/index.ts:119`

**Problem:** Function lacks explicit return type, relying on inference.

```typescript
// BEFORE (inferred)
export async function query(text: string, params?: unknown[], timeoutMs?: number) {
```

**Solution:** Add explicit return type annotation.

```typescript
// AFTER (explicit)
export async function query(text: string, params?: unknown[], timeoutMs?: number): Promise<import('pg').QueryResult> {
```

**Benefits:**
- Clear contract for callers
- Catches accidental return type changes
- Better IDE support

---

### 6. Bracket Notation Bypass

**File:** `apps/api/src/routes/billingStripe.ts:191`

**Problem:** Bracket notation bypasses type checking for property access.

```typescript
// BEFORE (unsafe)
if (!session["url"]) {
return reply.send({ url: session["url"] });
```

**Solution:** Use dot notation for type-checked access.

```typescript
// AFTER (safe)
if (!session.url) {
return reply.send({ url: session.url });
```

**Benefits:**
- TypeScript validates property names
- Catches typos at compile time
- Better refactoring support

---

### 7. Double Assertion Chain

**File:** `apps/api/src/routes/billingInvoiceExport.ts:88`

**Problem:** Chained type assertions bypass type checking.

```typescript
// BEFORE (unsafe)
(req as AuthenticatedRequest).user = jwt.verify(token, jwtKey, {
  algorithms: ['HS256']
}) as { stripeCustomerId?: string };
```

**Solution:** Use type guard for safe validation.

```typescript
// AFTER (safe)
const decoded = jwt.verify(token, jwtKey, { algorithms: ['HS256'] });
if (typeof decoded === 'object' && decoded !== null && 'stripeCustomerId' in decoded) {
  (req as AuthenticatedRequest).user = decoded as { stripeCustomerId?: string };
} else {
  (req as AuthenticatedRequest).user = {};
}
```

**Benefits:**
- Runtime validation of decoded token
- Safe property access
- Handles malformed tokens gracefully

---

### 8. Generic Covariance

**File:** `packages/database/transactions/index.ts:242`

**Problem:** Generic parameters lack proper constraints.

```typescript
// BEFORE (unconstrained)
export async function withLock<T, Row = Record<string, unknown>>(
```

**Solution:** Add proper generic constraints.

```typescript
// AFTER (constrained)
export async function withLock<T extends unknown, Row extends Record<string, unknown> = Record<string, unknown>>(
```

**Benefits:**
- Type-safe generic usage
- Prevents invalid type arguments
- Better type inference

---

### 9. Missing Exhaustiveness

**File:** `apps/api/src/jobs/domainExportJob.ts:269`

**Problem:** Switch statement lacks exhaustiveness check for union types.

```typescript
// BEFORE (incomplete)
default:
  throw new Error(`Unsupported format: ${format}`);
```

**Solution:** Add assertNever helper for compile-time exhaustiveness.

```typescript
// AFTER (exhaustive)
function assertNever(value: never, message: string): never {
  throw new Error(message);
}

default:
  return assertNever(format, `Unsupported format: ${format}`);
```

**Benefits:**
- Compile-time check for missing cases
- Type-safe switch statements
- Clear error messages

---

## Type Tests

Type tests are located at `test/types/p1-type-safety.test.ts`. Run with:

```bash
# Run type tests
npx jest test/types/p1-type-safety.test.ts

# Type check only
npx tsc --noEmit test/types/p1-type-safety.test.ts
```

## Best Practices Applied

1. **Always use explicit bounds checks** instead of non-null assertions for array access
2. **Handle bigint values as strings** with overflow protection
3. **Add explicit return types** to public API functions
4. **Use type guards** instead of type assertions when possible
5. **Prefer dot notation** over bracket notation for property access
6. **Add exhaustiveness checks** for switch statements on union types
7. **Constrain generic parameters** with appropriate bounds

## Migration Guide

When encountering similar issues in the future:

1. Identify the type safety issue using `tsc --strict`
2. Apply the appropriate fix pattern from this document
3. Add a type test to verify the fix
4. Update this documentation if a new pattern is introduced
