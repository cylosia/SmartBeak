# Console.log to Structured Logger - Migration Plan

## Quick Links

| Document | Purpose |
|----------|---------|
| `docs/developers/console-log-migration-quickstart.md` | Quick start guide for developers |
| `docs/developers/console-log-migration-plan.md` | Full detailed plan |
| `scripts/migrate-console-logs.ts` | Automated migration script |
| `scripts/console-log-migration-tracker.csv` | Progress tracking spreadsheet |

## Current Status

| Metric | Count |
|--------|-------|
| Files with console.log | ~150 |
| Total console statements | ~800+ |
| Priority P0 (Critical) | ~15 files |
| Priority P1 (High) | ~10 files |
| Priority P2-P3 (Medium/Low) | ~125 files |

## Migration Commands

```bash
# Find all console.log statements
npm run logger:find

# Count console.log statements
npm run logger:count

# Run automated migration (dry run)
npm run logger:migrate:dry-run -- "apps/api/src/routes/*.ts"

# Run automated migration (apply changes)
npm run logger:migrate -- "apps/api/src/routes/*.ts"

# Check for remaining console.log (CI check)
npm run logger:check
```

## Priority Order

### Phase 1: P0 - Critical (Security & Financial)
- [ ] `apps/api/src/routes/bulkPublishCreate.ts` (11 statements)
- [ ] `apps/api/src/routes/emailSubscribers.js` (12 statements)
- [ ] `apps/api/src/routes/email/index.ts` (10 statements)
- [ ] `apps/api/src/billing/*.ts` (26 statements across files)
- [ ] `apps/web/pages/api/webhooks/*.ts` (66 statements across files)
- [ ] `apps/web/lib/auth.ts` (11 statements)

**Why first:** These handle authentication, payments, and webhooks. Structured logging is critical for security audits and compliance.

### Phase 2: P1 - High (Core Services)
- [ ] `control-plane/services/billing.js` (15 statements)
- [ ] `control-plane/services/jwt.js` (10 statements)
- [ ] `control-plane/services/api-key-vault.ts` (6 statements)
- [ ] `packages/cache/multiTierCache.ts` (11 statements)

### Phase 3: P2 - Medium (Workers & Scripts)
- [ ] `scripts/performance-monitor.ts` (55 statements)
- [ ] `scripts/cache-warming.ts` (51 statements)
- [ ] `packages/kernel/queues/*.ts`
- [ ] `domains/*/application/*Worker.ts`

### Phase 4: P3 - Low (Remaining)
- [ ] All other files in `apps/`, `control-plane/`, `domains/`, `packages/`

## Basic Migration Pattern

```typescript
// BEFORE
console.log('[UserService] Creating user:', userId);
console.error('Failed to save:', error);
console.warn(`Rate limit hit for ${ip}`);

// AFTER
import { getLogger } from '@kernel/logger';
const logger = getLogger('UserService');

logger.info('Creating user', { userId });
logger.error('Failed to save', error);
logger.warn('Rate limit hit', { ip });
```

## Benefits of Structured Logging

1. **Searchability**: Query logs by field (userId, error type, etc.)
2. **Correlation**: Track requests across services with correlation IDs
3. **Security**: Automatic sensitive data redaction
4. **Monitoring**: Easy integration with log aggregation tools
5. **Debugging**: Request context automatically included

## Example Output

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "ERROR",
  "message": "[BillingService] Payment failed",
  "service": "BillingService",
  "correlationId": "req-123-abc",
  "userId": "user-456",
  "error": "Card declined",
  "metadata": {
    "amount": 99.99,
    "currency": "USD",
    "paymentMethod": "card_xxx"
  }
}
```

## Timeline Estimate

| Phase | Duration | Files | Effort |
|-------|----------|-------|--------|
| P0 - Critical | 3 days | 15 | High |
| P1 - High | 2 days | 10 | Medium |
| P2 - Medium | 5 days | 40 | Medium |
| P3 - Low | 5 days | 85 | Low |
| Testing & QA | 3 days | All | Medium |
| **Total** | **~3 weeks** | **~150** | - |

## Team Assignment Suggestion

| Team Member | Area | Files |
|-------------|------|-------|
| Backend Lead | API Routes, Billing | P0 + P1 |
| Backend Dev 1 | Webhooks, Auth | P0 webhooks |
| Backend Dev 2 | Control Plane | P1 services |
| Backend Dev 3 | Workers, Scripts | P2 |
| Junior Dev | Domain Layer | P3 |

## Success Criteria

- [ ] Zero `console.log` (except in scripts with justification)
- [ ] All `console.error` migrated to `logger.error(error, ...)`
- [ ] ESLint `no-console` rule enabled
- [ ] All tests pass
- [ ] Log aggregation validation passes

## Need Help?

1. Read the [Quick Start Guide](docs/developers/console-log-migration-quickstart.md)
2. Review the [Full Migration Plan](docs/developers/console-log-migration-plan.md)
3. Check the [tracking spreadsheet](scripts/console-log-migration-tracker.csv)
4. Ask in #dev-ops Slack channel

## Rollback

If issues arise:
```bash
# Revert specific file
git checkout HEAD -- path/to/file.ts

# Revert all changes
git checkout HEAD -- .
```

---

**Start Date:** TBD  
**Target Completion:** 3 weeks from start  
**Owner:** Backend Team Lead
