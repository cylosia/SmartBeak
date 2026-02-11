# Database Maintenance Utilities

This module provides utilities for database optimization and maintenance.

## Features

- **Sequence Monitoring**: Track BigInt primary key utilization and alert on thresholds
- **Vacuum Management**: Automated vacuum/analyze operations for table maintenance
- **Bloat Detection**: Detect table and index bloat with recommendations
- **Scheduled Maintenance**: Pre-configured maintenance schedules

## Quick Start

```typescript
import { maintenance } from '@smartbeak/database';
import { knex } from './db';

// Run sequence monitoring
const result = await maintenance.runSequenceMonitoring(knex);
console.log(`${result.critical_count} critical sequences found`);

// Check for table bloat
const bloat = await maintenance.runBloatAnalysis(knex);
console.log(bloat.recommendations);
```

## Sequence Monitoring

Monitors database sequences for exhaustion risk.

```typescript
// Get all sequence health
const sequences = await maintenance.getSequenceHealth(knex);

// Check for critical sequences
const critical = await maintenance.getCriticalSequences(knex);

// Generate alerts for sequences above 80%
const newAlerts = await maintenance.generateSequenceAlerts(knex, 80);

// Estimate when a sequence will exhaust
const estimate = await maintenance.estimateSequenceExhaustion(
  knex, 
  'content_items_id_seq', 
  30
);
```

### Alert Thresholds

- **OK**: < 80% utilization
- **WARNING**: 80-94% utilization
- **CRITICAL**: >= 95% utilization

## Vacuum Management

Manages vacuum and analyze operations.

```typescript
// Vacuum a specific table
const result = await maintenance.vacuumAnalyzeTable(knex, 'audit_events');

// Vacuum all high-churn tables
const results = await maintenance.vacuumHighChurnTables(knex);

// Run comprehensive vacuum maintenance
const maintenance = await maintenance.runVacuumMaintenance(knex, {
  minDeadTupleRatio: 10,
  includeHighChurn: true,
});
```

### High-Churn Tables

The following tables are vacuumed every 6 hours by default:
- `audit_events`
- `analytics_events`
- `job_executions`
- `notifications`
- `publishing_jobs`
- `publish_attempts`

## Bloat Detection

Detects and reports table and index bloat.

```typescript
// Get bloat for all tables
const bloat = await maintenance.getTableBloat(knex);

// Get only critical bloat
const critical = await maintenance.getCriticalBloat(knex);

// Run comprehensive analysis
const analysis = await maintenance.runBloatAnalysis(knex);

// Get unused indexes (candidates for removal)
const unused = await maintenance.getUnusedIndexes(knex, 7);
```

### Bloat Thresholds

- **OK**: < 15% dead tuples
- **WARNING**: 15-30% dead tuples or > 5,000 dead tuples
- **CRITICAL**: > 30% dead tuples or > 10,000 dead tuples

## Scheduled Maintenance

Pre-configured maintenance schedule:

```typescript
import { executeMaintenanceTask, DEFAULT_MAINTENANCE_SCHEDULE } from './maintenance/scheduler';

// Execute a specific task
const result = await executeMaintenanceTask(knex, 'sequence_check');

// Get maintenance status
const status = await maintenance.getMaintenanceStatus(knex);
console.log(maintenance.formatMaintenanceStatus(status));
```

### Default Schedule

| Task | Frequency | Description |
|------|-----------|-------------|
| sequence_check | Every 15 min | Monitor critical sequence thresholds |
| sequence_alert | Daily 9 AM | Generate alerts for sequences > 80% |
| vacuum_high_churn | Every 6 hours | Vacuum high-churn tables |
| vacuum_bloated | Daily 2 AM | Vacuum tables with high bloat |
| bloat_analysis | Weekly Mon 8 AM | Comprehensive bloat report |
| full_maintenance | Weekly Sun 3 AM | Complete maintenance cycle |

## Health Check Integration

```typescript
// Create health check for monitoring systems
const health = await maintenance.createHealthCheck(knex);

if (!health.healthy) {
  console.error('Database maintenance issues:', health.checks);
}
```

## Migration Files

The following migrations set up the database objects:

- `017_foreign_key_indexes.sql` - Foreign key indexes
- `018_jsonb_gin_indexes.sql` - GIN indexes for JSONB
- `019_partial_indexes_soft_delete.sql` - Partial indexes for soft deletes
- `020_autovacuum_configuration.sql` - Autovacuum tuning
- `021_bigint_sequence_monitoring.sql` - Sequence monitoring

## SQL Functions

### Sequence Monitoring

- `check_sequence_utilization(threshold)` - Check sequence utilization
- `generate_sequence_alerts(threshold)` - Generate alerts
- `estimate_sequence_reset_date(sequence, days)` - Estimate exhaustion

### Vacuum/Bloat

- `db_vacuum_statistics` - View vacuum stats
- `db_table_bloat` - View table bloat

## Best Practices

1. **Sequence Monitoring**: Run every 15 minutes for critical sequences, daily for all
2. **Vacuum**: Let autovacuum handle most tables, manually vacuum high-churn tables
3. **Bloat Analysis**: Run weekly to catch issues early
4. **Alerts**: Acknowledge alerts promptly and take action on critical issues

## Related Documentation

- [PostgreSQL Autovacuum](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [PostgreSQL Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
- [PostgreSQL Sequence Exhaustion](https://www.postgresql.org/docs/current/datatype-numeric.html#DATATYPE-SERIAL)
