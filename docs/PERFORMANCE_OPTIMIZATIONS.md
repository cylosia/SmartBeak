# Performance Optimizations (P2)

This document describes the performance optimizations implemented across the SmartBeak codebase.

## Table of Contents

1. [Query Optimization](#query-optimization)
2. [Caching Layer](#caching-layer)
3. [Connection Pooling](#connection-pooling)
4. [Bundle Size Optimization](#bundle-size-optimization)
5. [Performance Monitoring](#performance-monitoring)

---

## Query Optimization

### 1. Query Result Caching

Location: `packages/database/query-optimization/queryCache.ts`

Caches frequently accessed query results with:
- **Stale-while-revalidate** pattern for fresh data without latency
- Automatic invalidation based on table changes
- Configurable TTL per query

```typescript
import { DbQueryCache, getGlobalDbCache } from '@smartbeak/database/queryOptimization';

// Using the global cache instance
const cache = getGlobalDbCache();

// Execute query with caching
const result = await cache.query(pool, 
  'SELECT * FROM users WHERE status = $1', 
  ['active'],
  { ttlMs: 60000 }
);

// Invalidate by table
await cache.invalidateTable('users');

// Get statistics
console.log(cache.getStats());
```

### 2. Cursor-Based Pagination

Location: `packages/database/query-optimization/pagination.ts`

Replaces OFFSET-based pagination with cursor-based pagination for O(1) performance:

```typescript
import { CursorPaginator } from '@smartbeak/database/queryOptimization';

const paginator = new CursorPaginator(pool);

const result = await paginator.paginate({
  table: 'content_items',
  select: ['id', 'title', 'created_at'],
  where: 'status = $1',
  whereParams: ['published'],
  cursor: request.query.cursor,
  limit: 25,
  cursorColumn: 'created_at',
  sortOrder: 'desc',
});

// Returns: { data: T[], pagination: { hasNext, hasPrev, nextCursor, prevCursor } }
```

**Benefits:**
- O(1) performance regardless of page depth
- Consistent results during concurrent writes
- No skipping or duplication of rows

### 3. Query Plan Analysis

Location: `packages/database/query-optimization/queryPlan.ts`

Analyzes query execution plans for optimization:

```typescript
import { QueryPlanAnalyzer } from '@smartbeak/database/queryOptimization';

const analyzer = new QueryPlanAnalyzer(pool);

// Analyze a query
const analysis = await analyzer.analyze(
  'SELECT * FROM users WHERE email = $1',
  ['user@example.com']
);

console.log(analysis.recommendations);
console.log(analysis.sequentialScans); // Tables with seq scans
console.log(analysis.warnings); // Performance warnings

// Get index recommendations
const recommendations = await analyzer.getIndexRecommendations('users');
```

---

## Caching Layer

### 1. Multi-Tier Cache

Location: `packages/cache/multiTierCache.ts`

Two-tier caching system (L1: Memory, L2: Redis):

```typescript
import { MultiTierCache, getGlobalCache, Cacheable } from '@smartbeak/cache';

// Initialize cache
const cache = new MultiTierCache({
  l1MaxSize: 1000,
  l1TtlMs: 60000,
  l2TtlSeconds: 300,
  keyPrefix: 'myapp:',
  stampedeProtection: true,
});

await cache.initializeRedis(process.env.REDIS_URL);

// Get or compute with caching
const data = await cache.getOrCompute(
  'user:123:profile',
  async () => await fetchUserProfile(123),
  { l1TtlMs: 30000, l2TtlSeconds: 60, tags: ['user', 'profile'] }
);

// Using decorator
class UserService {
  @Cacheable({ key: 'user-profile', ttlMs: 60000 })
  async getUserProfile(userId: string) {
    return await fetchUserProfile(userId);
  }
}
```

### 2. Cache Warming

Location: `packages/cache/cacheWarming.ts`

Pre-loads frequently accessed data:

```typescript
import { CacheWarmer, warmingStrategies } from '@smartbeak/cache';

const warmer = new CacheWarmer(cache, {
  intervalMs: 5 * 60 * 1000, // 5 minutes
  maxConcurrent: 5,
  warmOnStartup: true,
  warmingWindow: warmingStrategies.lowTrafficHours(), // 2-5 AM
});

// Register data sources
warmer.register({
  id: 'user-preferences',
  fetch: async () => await fetchUserPreferences(),
  cacheKey: 'config:user-preferences',
  priority: 10,
  ttlMs: 300000,
  tags: ['config'],
});

warmer.start();
```

### 3. Cache Invalidation

Location: `packages/cache/cacheInvalidation.ts`

Multiple invalidation strategies:

```typescript
import { CacheInvalidator, createEntityInvalidationEvent } from '@smartbeak/cache';

const invalidator = new CacheInvalidator(cache);

// Invalidate by tags
await invalidator.invalidateByTags(['user', 'profile']);

// Invalidate by pattern
await invalidator.invalidateByPattern('user:*');

// Event-driven invalidation
const event = createEntityInvalidationEvent('user', '123', 'update');
await invalidator.processEvent(event);
```

### 4. Cache Stampede Protection

Location: `packages/utils/cacheStampedeProtection.ts`

Prevents cache stampede with in-flight request deduplication:

```typescript
import { getOrComputeWithStampedeProtection } from '@smartbeak/utils';

const result = await getOrComputeWithStampedeProtection(
  'expensive-key',
  async () => await expensiveOperation(),
  {
    cacheGetter: async () => await redis.get('key'),
    cacheSetter: async (value) => await redis.set('key', value),
    timeoutMs: 30000,
  }
);
```

---

## Connection Pooling

### 1. Pool Health Monitoring

Location: `packages/database/query-optimization/connectionHealth.ts`

Monitors and optimizes connection pool:

```typescript
import { PoolHealthMonitor } from '@smartbeak/database/queryOptimization';

const monitor = new PoolHealthMonitor(pool, {
  minSize: 5,
  maxSize: 50,
  targetUtilization: 0.7,
  dynamicSizing: true,
  healthCheckIntervalMs: 30000,
});

monitor.on('metrics', (metrics) => {
  console.log(`Utilization: ${(metrics.utilization * 100).toFixed(1)}%`);
});

monitor.on('alert', (alert) => {
  console.warn(`Alert: ${alert.message}`);
});

monitor.start();
```

### 2. Connection Health Checks

```typescript
import { checkDatabaseHealth } from '@smartbeak/database/queryOptimization';

const health = await checkDatabaseHealth(pool);
console.log(`Healthy: ${health.healthy}, Latency: ${health.latency}ms`);
```

### 3. Pool Sizing Recommendations

```typescript
import { poolSizingGuide } from '@smartbeak/database/queryOptimization';

const recommendedSize = poolSizingGuide.calculateRecommendedSize({
  concurrentRequests: 100,
  averageQueryTimeMs: 50,
  requestDurationMs: 200,
  cpuCores: 4,
});

console.log(`Recommended pool size: ${recommendedSize}`);
```

---

## Bundle Size Optimization

### 1. Optimized Next.js Configuration

Location: `apps/web/next.config.optimized.js`

```javascript
// next.config.js
const nextConfig = {
  // Tree shaking
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  
  // Code splitting
  webpack: (config) => {
    config.optimization.splitChunks = {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          priority: 10,
        },
        react: {
          test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
          priority: 20,
        },
      },
    };
    return config;
  },
  
  // Package optimization
  experimental: {
    optimizePackageImports: ['lodash', 'date-fns', '@mui/material'],
  },
};
```

### 2. Bundle Analysis

```bash
# Analyze bundle size
npm run analyze:bundle

# CI bundle check
npm run build:web
```

Bundle analysis runs automatically on every PR via GitHub Actions.

### 3. Performance Budgets

Location: `apps/web/lib/bundle-analysis.ts`

```typescript
import { PerformanceBudgetChecker, performanceBudgets } from '@/lib/bundle-analysis';

const checker = new PerformanceBudgetChecker(performanceBudgets.balanced);

const result = checker.checkBudget({
  js: 180000,  // 180 KB
  css: 40000,  // 40 KB
  images: 300000, // 300 KB
});

if (!result.withinBudget) {
  console.warn('Budget overages:', result.overages);
}
```

---

## Performance Monitoring

### 1. Web Vitals Hook

Location: `apps/web/hooks/use-performance.ts`

```typescript
import { useWebVitals, useRenderPerformance } from '@/hooks/use-performance';

function MyComponent() {
  // Track Web Vitals
  const vitals = useWebVitals((metrics) => {
    // Send to analytics
    console.log('LCP:', metrics.lcp);
    console.log('FID:', metrics.fid);
    console.log('CLS:', metrics.cls);
  });

  // Track render performance
  const renderMetrics = useRenderPerformance('MyComponent');
  
  return <div>Component</div>;
}
```

### 2. Performance Monitor Script

```bash
# Start performance monitoring
npm run perf:monitor
```

Monitors:
- Cache hit rates
- Query execution times
- Memory usage
- Request latency

### 3. Performance Monitoring Service

Location: `packages/cache/performanceHooks.ts`

```typescript
import { PerformanceMonitor } from '@smartbeak/cache';

const monitor = new PerformanceMonitor(cache, {
  thresholds: {
    minCacheHitRate: 0.8,
    maxQueryTimeMs: 1000,
    maxMemoryPercent: 85,
    maxLatencyMs: 500,
  },
  onAlert: (alert) => {
    // Send to alerting service
    console.warn(alert.message);
  },
});

monitor.start();
```

---

## Running the Optimizations

### Cache Warming

```bash
# Run once
npm run cache:warm -- --one-shot

# Run continuously (with scheduling)
npm run cache:warm
```

### Performance Monitoring

```bash
# Start monitoring service
npm run perf:monitor
```

### Bundle Analysis

```bash
# Local analysis
npm run analyze:bundle

# CI check (runs automatically on PRs)
git push origin feature/my-feature
```

---

## Environment Variables

### Cache Configuration

```bash
# Redis connection
REDIS_URL=redis://localhost:6379

# Cache warming
CACHE_WARM_INTERVAL_MS=300000
LOW_TRAFFIC_START_HOUR=2
LOW_TRAFFIC_END_HOUR=5
```

### Performance Monitoring

```bash
# Monitoring
MONITOR_INTERVAL_MS=60000
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...

# Thresholds
MIN_CACHE_HIT_RATE=0.8
MAX_QUERY_TIME_MS=1000
MAX_MEMORY_PERCENT=85
MAX_LATENCY_MS=500
```

### Bundle Analysis

```bash
# Enable bundle analyzer
ANALYZE=true
```

---

## Summary

| Optimization | Location | Status |
|--------------|----------|--------|
| Multi-tier caching | `packages/cache/` | ✅ Implemented |
| Query result caching | `packages/database/query-optimization/` | ✅ Implemented |
| Cursor-based pagination | `packages/database/query-optimization/` | ✅ Implemented |
| Query plan analysis | `packages/database/query-optimization/` | ✅ Implemented |
| Cache warming | `packages/cache/` + `scripts/` | ✅ Implemented |
| Cache invalidation | `packages/cache/` | ✅ Implemented |
| Connection pool health | `packages/database/query-optimization/` | ✅ Implemented |
| Bundle optimization | `apps/web/next.config.optimized.js` | ✅ Implemented |
| Performance monitoring | `apps/web/hooks/` + `packages/cache/` | ✅ Implemented |
| CI bundle analysis | `.github/workflows/bundle-analysis.yml` | ✅ Implemented |
