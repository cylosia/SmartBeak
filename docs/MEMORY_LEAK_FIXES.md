# Memory Leak Fixes Documentation

## Overview

This document describes critical memory leak vulnerabilities that were identified and fixed in the SmartBeak application. These leaks were causing production OOM (Out Of Memory) crashes due to unbounded growth of internal data structures.

## Vulnerabilities Fixed

### 1. Unbounded Metrics Collector (`packages/monitoring/metrics-collector.ts`)

#### Vulnerability
The `MetricsCollector` class used a plain `Map<string, Metric[]>` to store metrics indexed by key. Each unique metric name + label combination created a new key in the Map. With high-cardinality labels (like request IDs, user IDs, or timestamps), the Map would grow indefinitely, consuming all available memory.

```typescript
// VULNERABLE CODE
private readonly metrics: Map<string, Metric[]> = new Map();

record(metric: Metric): void {
  const key = this.getMetricKey(metric.name, metric.labels);
  if (!this.metrics.has(key)) {
    this.metrics.set(key, []);  // Key never removed!
  }
  // ...
}
```

#### Impact
- **Severity**: Critical
- **Memory Growth**: Unbounded
- **Crash Type**: OOM after hours/days in production
- **Trigger**: High-cardinality metric labels

#### Fix
Implemented LRU (Least Recently Used) eviction with the following features:

1. **Maximum Key Limit**: Default 10,000 keys (`MAX_METRIC_KEYS`)
2. **LRU Tracking**: Maintains access order in `keyAccessOrder` array
3. **Automatic Eviction**: Removes oldest 10% of keys when limit exceeded
4. **Monitoring**: Emits events and logs warnings when approaching limits
5. **Internal Metrics**: Tracks key count, utilization, and eviction stats

```typescript
// FIXED CODE
private readonly keyAccessOrder: string[] = [];
private keysEvicted = 0;

private evictOldestKeysIfNeeded(): void {
  if (this.metrics.size <= this.config.maxKeys) return;
  
  const keysToEvict = this.metrics.size - this.config.maxKeys;
  for (let i = 0; i < keysToEvict; i++) {
    const oldestKey = this.keyAccessOrder.shift();
    if (oldestKey && this.metrics.has(oldestKey)) {
      this.metrics.delete(oldestKey);
      this.aggregations.delete(oldestKey);
      evicted++;
    }
  }
}
```

#### Configuration Options
```typescript
export interface AggregationConfig {
  maxKeys?: number;              // Default: 10000
  enableSizeMonitoring?: boolean; // Default: true
}
```

---

### 2. Query Cache Version Growth (`packages/cache/queryCache.ts`)

#### Vulnerability
The `QueryCache` used a `Map<string, number>` to track query versions for cache invalidation. Each unique table combination created a version key that was never cleaned up, leading to unbounded growth.

```typescript
// VULNERABLE CODE
private queryVersions = new Map<string, number>();

async invalidateTable(tableName: string): Promise<void> {
  const currentVersion = this.queryVersions.get(tableName) ?? 1;
  this.queryVersions.set(tableName, currentVersion + 1);  // Never cleared!
}
```

#### Impact
- **Severity**: High
- **Memory Growth**: Unbounded with dynamic table names
- **Crash Type**: OOM over extended periods
- **Trigger**: Dynamic table names or complex join combinations

#### Fix
Implemented version cleanup with the following features:

1. **Maximum Version Keys**: Default 5,000 keys (`MAX_VERSION_KEYS`)
2. **Metadata Tracking**: Each entry tracks `lastAccessed` and `tableCount`
3. **LRU Eviction**: Evicts oldest entries when limit exceeded
4. **Periodic Cleanup**: Background cleanup every 10 minutes
5. **Version Reset**: Resets version counter at 1,000,000 to prevent integer overflow

```typescript
// FIXED CODE
interface VersionEntry {
  version: number;
  lastAccessed: number;
  tableCount: number;
}

private queryVersions = new Map<string, VersionEntry>();

private evictOldVersionsIfNeeded(): void {
  if (this.queryVersions.size < MAX_VERSION_KEYS) return;
  
  const entries = Array.from(this.queryVersions.entries())
    .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  
  // Evict oldest 10%
  const keysToEvict = Math.ceil(MAX_VERSION_KEYS * 0.1);
  for (let i = 0; i < keysToEvict; i++) {
    this.queryVersions.delete(entries[i]![0]);
  }
}
```

---

### 3. In-Flight Request Accumulation (`packages/cache/multiTierCache.ts`)

#### Vulnerability
The `MultiTierCache` used a `Map<string, Promise<unknown>>` to track in-flight requests for stampede protection. If a request hung or timed out without proper cleanup, the entry would remain in the Map forever.

```typescript
// VULNERABLE CODE
private inFlightRequests = new Map<string, Promise<unknown>>();

async getOrCompute<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const inFlight = this.inFlightRequests.get(fullKey);
  if (inFlight) {
    return inFlight as Promise<T>;  // Could wait forever!
  }
  
  const computation = this.computeAndCache(key, factory, options);
  this.inFlightRequests.set(fullKey, computation);
  
  try {
    return await computation;
  } finally {
    this.inFlightRequests.delete(fullKey);  // Might not execute!
  }
}
```

#### Impact
- **Severity**: Critical
- **Memory Growth**: Unbounded with hanging requests
- **Crash Type**: OOM and request pile-up
- **Trigger**: Slow/hanging backend requests

#### Fix
Implemented TTL-based cleanup with the following features:

1. **Maximum In-Flight**: Default 1,000 concurrent requests
2. **TTL Tracking**: Each entry tracks `createdAt` timestamp
3. **Automatic Timeout**: Sets timeout for each in-flight request
4. **Stale Detection**: Checks request age before reusing
5. **Periodic Cleanup**: Background cleanup every 10 seconds
6. **Safety Limit**: Maximum 5 minutes for any in-flight request

```typescript
// FIXED CODE
interface InFlightEntry<T> {
  promise: Promise<T>;
  createdAt: number;
  key: string;
  timeoutId?: NodeJS.Timeout;
}

private inFlightRequests = new Map<string, InFlightEntry<unknown>>();

async getOrCompute<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const inFlight = this.inFlightRequests.get(fullKey);
  if (inFlight) {
    const age = Date.now() - inFlight.createdAt;
    if (age <= this.options.inFlightTtlMs) {
      return inFlight.promise as Promise<T>;
    }
    // Stale - remove and continue
    this.inFlightRequests.delete(fullKey);
  }
  
  // Set up automatic cleanup timeout
  const entry: InFlightEntry<T> = {
    promise: computation,
    createdAt: Date.now(),
    key: fullKey,
  };
  
  entry.timeoutId = setTimeout(() => {
    this.inFlightRequests.delete(fullKey);
    this.inFlightTimeouts++;
  }, timeoutMs);
  
  this.inFlightRequests.set(fullKey, entry);
  
  try {
    return await computation;
  } finally {
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    this.inFlightRequests.delete(fullKey);
  }
}
```

---

## Testing

### Test Coverage

Comprehensive memory leak tests have been added:

| File | Description |
|------|-------------|
| `packages/monitoring/__tests__/metrics-collector.memory.test.ts` | Tests for metrics collector LRU eviction |
| `packages/cache/__tests__/queryCache.memory.test.ts` | Tests for query cache version cleanup |
| `packages/cache/__tests__/multiTierCache.memory.test.ts` | Tests for in-flight request TTL cleanup |

### Running Tests

```bash
# Run all memory leak tests
npm test -- --testPathPattern="memory.test"

# Run specific test file
npm test -- packages/monitoring/__tests__/metrics-collector.memory.test.ts

# Run with coverage
npm test -- --testPathPattern="memory.test" --coverage
```

### Key Test Scenarios

1. **Metrics Collector**
   - Verifies key limit enforcement (100 keys in test)
   - Tests LRU eviction of oldest keys
   - Validates event emission on eviction
   - Checks high watermark alerting

2. **Query Cache**
   - Verifies version key limit (5,000 in production)
   - Tests LRU eviction based on last access time
   - Validates periodic cleanup functionality
   - Checks version number reset at max value

3. **Multi-Tier Cache**
   - Verifies in-flight request limit (1,000)
   - Tests automatic timeout cleanup
   - Validates stale request detection
   - Checks proper cleanup on errors

---

## Monitoring

### Internal Metrics

All fixed components now expose internal metrics for monitoring:

```typescript
// Metrics Collector
counter('metrics.collector.keys', keyCount);
counter('metrics.collector.utilization', utilizationPercent);
counter('metrics.collector.evicted', totalEvicted);

// Query Cache (in stats)
{
  versionKeys: number;
  versionsCleaned: number;
}

// Multi-Tier Cache (in stats)
{
  inFlightRequests: number;
  inFlightCleaned: number;
  inFlightTimeouts: number;
}
```

### Alerting Recommendations

Set up alerts for the following conditions:

| Component | Metric | Threshold | Severity |
|-----------|--------|-----------|----------|
| Metrics Collector | `keys` | > 8,000 | Warning |
| Metrics Collector | `evicted` | > 0 (sustained) | Warning |
| Query Cache | `versionKeys` | > 4,000 | Warning |
| Multi-Tier Cache | `inFlightRequests` | > 800 | Warning |
| Multi-Tier Cache | `inFlightTimeouts` | > 0 (sustained) | Critical |

---

## Prevention Guidelines

### For Developers

1. **Avoid High-Cardinality Labels**: Never use unique IDs (requestId, userId, sessionId) as metric labels
2. **Use Bounded Data Structures**: Always consider size limits for Maps and Sets
3. **Implement Cleanup**: Every `set()` should have a corresponding `delete()`
4. **Add TTLs**: Use timeouts for any async operation tracking
5. **Monitor Growth**: Log sizes of internal data structures

### Code Review Checklist

- [ ] Are all Maps/Sets bounded?
- [ ] Is there LRU or TTL-based eviction?
- [ ] Are cleanup handlers in finally blocks?
- [ ] Are timeouts set for async operations?
- [ ] Is there monitoring for data structure sizes?

---

## References

- [Node.js Memory Management](https://nodejs.org/en/docs/guides/dont-block-the-event-loop/)
- [LRU Cache Pattern](https://en.wikipedia.org/wiki/Cache_replacement_policies#Least_recently_used_(LRU))
- [Cache Stampede Prevention](https://en.wikipedia.org/wiki/Cache_stampede)
