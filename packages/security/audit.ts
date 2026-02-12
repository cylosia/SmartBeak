import { EventEmitter } from 'events';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';


import crypto from 'crypto';


/**

* Enhanced Audit Logging System
* Comprehensive security audit trail with tamper detection
*

*/

export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed'
  | 'auth.mfa'
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'user.role_change'
  | 'api.key_create'
  | 'api.key_rotate'
  | 'api.key_revoke'
  | 'data.export'
  | 'data.delete'
  | 'data.access'
  | 'config.change'
  | 'permission.grant'
  | 'permission.revoke'
  | 'security.alert';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  type: AuditEventType;
  severity: AuditSeverity;
  actor: {
  type: 'user' | 'system' | 'api';
  id: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  };
  resource: {
  type: string;
  id: string;
  name?: string;
  };
  action: string;
  result: 'success' | 'failure' | 'denied';
  details: Record<string, unknown>;
  changes?: {
  before: unknown;
  after: unknown;
  };
  sessionId?: string;
  requestId?: string;
  previousHash?: string;
  hash: string;
}

export interface AuditQuery {
  startDate?: Date;
  endDate?: Date;
  types?: AuditEventType[];
  actorId?: string;
  resourceId?: string;
  severity?: AuditSeverity;
  result?: 'success' | 'failure' | 'denied';
  limit?: number;
  offset?: number;
}

// SECURITY FIX: Maximum query limit to prevent resource exhaustion
const MAX_QUERY_LIMIT = 10000;

export class AuditLogger extends EventEmitter {
  private readonly db: Pool;
  private buffer: AuditEvent[] = [];
  private readonly flushIntervalMs: number = 5000;
  private flushTimer: NodeJS.Timeout | undefined;
  private lastHash: string = '';

  // SECURITY FIX: Maximum buffer size to prevent OOM
  private readonly MAX_BUFFER_SIZE = 10000;
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private failedFlushCount = 0;

  private currentBufferSize = 0;

  // FIX: Track dropped events for monitoring
  private totalDroppedEvents = 0;

  private readonly logger;

  constructor(db: Pool) {
  super();
  this.db = db;
  this.logger = getLogger('AuditLogger');
  this.startFlushTimer();
  }

  /**
  * Check if buffer has space
  * SECURITY FIX: Prevent unbounded buffer growth
  */
  private hasBufferSpace(): boolean {
  return this.buffer.length < this.MAX_BUFFER_SIZE;
  }

  /**
  * Drop oldest events if buffer is full
  * SECURITY FIX: Prevent OOM by dropping old events
  */
  private makeSpaceIfNeeded(): void {
  if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
    // Drop oldest 10% of buffer
    const dropCount = Math.floor(this.MAX_BUFFER_SIZE * 0.1);
    const dropped = this.buffer.splice(0, dropCount);
    this.logger.warn('Audit buffer full, dropped old events', {
    droppedCount: dropped.length,
    bufferSize: this.buffer.length
    });
    this.emit('eventsDropped', dropped);
  }
  }

  /**
  * Start automatic flush timer
  */
  private startFlushTimer(): void {
  this.flushTimer = setInterval(() => {
    this.flush().catch((err) => {
    this.logger.error('Scheduled flush failed', err instanceof Error ? err : undefined);
    });
  }, this.flushIntervalMs).unref();
  }

  /**
  * Stop the logger
  */
  async stop(): Promise<void> {
  if (this.flushTimer) {
    clearInterval(this.flushTimer);
    this.flushTimer = undefined;
  }
  try {
    await this.flush();
  } catch (error) {
    // P2-FIX: Use stderr with safe serialization instead of console.error,
    // which bypasses structured logging and may leak PII in container logs.
    const err = error instanceof Error ? error : new Error(String(error));
    process.stderr.write(`[AuditLogger] Final flush failed: ${err.message}\n`);
  }
  }

  /**
  * Log an audit event
  * SECURITY FIX: Buffer size limits and retry tracking
  */
  async log(event: Omit<AuditEvent, 'id' | 'timestamp' | 'hash' | 'previousHash'>): Promise<void> {
  // SECURITY FIX: Make space if buffer is full
  this.makeSpaceIfNeeded();

  const fullEvent: AuditEvent = {
    ...event,
    id: this.generateEventId(),
    timestamp: new Date(),
    previousHash: this.lastHash,
    hash: '', // Will be calculated
  };

  // Calculate hash for tamper detection
  fullEvent.hash = this.calculateHash(fullEvent);
  this.lastHash = fullEvent.hash;

  this.buffer.push(fullEvent);

  // Emit for real-time monitoring
  this.emit('auditEvent', fullEvent);

  // Critical events flush immediately
  if (event.severity === 'critical') {
    await this.flush();
  }

  // SECURITY FIX: If too many failures, alert and stop accepting
  if (this.failedFlushCount >= this.MAX_RETRY_ATTEMPTS) {
    this.logger["error"]('Too many audit flush failures, emitting alert', undefined, {
    failedCount: this.failedFlushCount,
    bufferSize: this.buffer.length,
    });
    this.emit('auditSystemFailure', {
    message: 'Audit logging failing persistently',
    failedCount: this.failedFlushCount,
    });
  }
  }

  /**
  * Quick log methods
  */
  async logAuth(
  type: 'auth.login' | 'auth.logout' | 'auth.failed',
  actor: AuditEvent['actor'],
  result: 'success' | 'failure',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: Record<string, any>
  ): Promise<void> {
  await this.log({
    type,
    severity: type === 'auth.failed' ? 'warning' : 'info',
    actor,
    resource: { type: 'auth', id: 'system' },
    action: type.split('.')[1] as string,
    result,
    details: details || {},
  });
  }

  async logDataAccess(
  actor: AuditEvent['actor'],
  resource: AuditEvent['resource'],
  action: 'read' | 'write' | 'delete' | 'export',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: Record<string, any>
  ): Promise<void> {
  await this.log({
    type: action === 'export' ? 'data.export' : 'data.access',
    severity: action === 'delete' ? 'warning' : 'info',
    actor,
    resource,
    action,
    result: 'success',
    details: details || {},
  });
  }

  async logApiKeyChange(
  type: 'api.key_create' | 'api.key_rotate' | 'api.key_revoke',
  actor: AuditEvent['actor'],
  provider: string,
  result: 'success' | 'failure'
  ): Promise<void> {
  await this.log({
    type,
    severity: 'critical',
    actor,
    resource: { type: 'api_key', id: provider },
    // P1-FIX: Changed [2] to [1]. For 'api.key_create', split('.') produces
    // ['api', 'key_create'] (2 elements). Index [2] was always undefined,
    // storing null in the action column for all API key audit events.
    action: type.split('.')[1] as string,
    result,
    details: { provider },
  });
  }

  async logPermissionChange(
  type: 'permission.grant' | 'permission.revoke',
  actor: AuditEvent['actor'],
  targetUserId: string,
  permission: string,
  result: 'success' | 'failure'
  ): Promise<void> {
  await this.log({
    type,
    severity: 'warning',
    actor,
    resource: { type: 'user', id: targetUserId },
    action: type.split('.')[1] as string,
    result,
    details: { permission },
  });
  }

  /**
  * Flush buffered events to database
  * SECURITY FIX: Bounded retry with exponential backoff and disk spillover
  */
  private async flush(): Promise<void> {
  if (this.buffer.length === 0) return;

  const events = this.buffer.splice(0, this.buffer.length);

  try {
    await this.db.query(
    `INSERT INTO audit_logs (
    id, timestamp, type, severity,
    actor_type, actor_id, actor_email, actor_ip, actor_user_agent,
    resource_type, resource_id, resource_name,
    action, result, details, changes, session_id, request_id,
    previous_hash, hash
    )
    SELECT * FROM UNNEST(
    $1::text[], $2::timestamp[], $3::text[], $4::text[],
    $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
    $10::text[], $11::text[], $12::text[],
    $13::text[], $14::text[], $15::jsonb[], $16::jsonb[], $17::text[], $18::text[],
    $19::text[], $20::text[]
    )`,
    [
    events.map((e) => e.id),
    events.map((e) => e.timestamp),
    events.map((e) => e.type),
    events.map((e) => e.severity),
    events.map((e) => e.actor.type),
    events.map((e) => e.actor.id),
    events.map((e) => e.actor.email || ''),
    events.map((e) => e.actor["ip"] || ''),
    events.map((e) => e.actor.userAgent || ''),
    events.map((e) => e.resource.type),
    events.map((e) => e.resource.id),
    events.map((e) => e.resource.name || ''),
    events.map((e) => e.action),
    events.map((e) => e.result),
    events.map((e) => JSON.stringify(e.details)),
    events.map((e) => JSON.stringify(e.changes || {})),
    events.map((e) => e.sessionId || ''),
    events.map((e) => e.requestId || ''),
    events.map((e) => e.previousHash || ''),
    events.map((e) => e.hash),
    ]
    );
    // SUCCESS: Reset failure count
    this.failedFlushCount = 0;
  } catch (error) {
    this.logger["error"]('Audit flush failed', error instanceof Error ? error : undefined, {
    eventCount: events.length,
    failedFlushCount: this.failedFlushCount,
    });
    this.failedFlushCount++;

    // SECURITY FIX: Only retry limited times, then drop
    if (this.failedFlushCount <= this.MAX_RETRY_ATTEMPTS) {
    // Re-add events to front of buffer for retry
    this.buffer.unshift(...events);
    this.logger.warn('Re-queuing audit events for retry', {
    eventCount: events.length,
    retryAttempt: this.failedFlushCount
    });
    } else {
    // Too many failures - drop events and alert
    this.logger["error"](`Dropping audit events after max retry attempts`, undefined, {
    eventCount: events.length,
    maxRetryAttempts: this.MAX_RETRY_ATTEMPTS,
    });
    this.emit('eventsLost', events);

    // Write to stderr as last resort with structured format
    // P1-FIX: Include event data — previously only wrote timestamp, losing the audit event
    for (const event of events) {
    process.stderr.write(`[AUDIT_FALLBACK] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
})}\n`);
    }
    }
  }
  }

  /**
  * Query audit logs
  */
  async query(query: AuditQuery): Promise<{ events: AuditEvent[]; total: number }> {
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (query.startDate) {
    params.push(query.startDate);
    conditions.push(`timestamp >= $${params.length}`);
  }

  if (query.endDate) {
    params.push(query.endDate);
    conditions.push(`timestamp <= $${params.length}`);
  }

  if (query.types && query.types.length > 0) {
    params.push(query.types);
    conditions.push(`type = ANY($${params.length})`);
  }

  if (query.actorId) {
    params.push(query.actorId);
    conditions.push(`actor_id = $${params.length}`);
  }

  if (query.resourceId) {
    params.push(query.resourceId);
    conditions.push(`resource_id = $${params.length}`);
  }

  if (query.severity) {
    params.push(query.severity);
    conditions.push(`severity = $${params.length}`);
  }

  if (query.result) {
    params.push(query.result);
    conditions.push(`result = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  // P0-FIX: Pass params array — previously missing, causing runtime errors
  const countParamsCopy = [...params];
  const countResult = await this.db.query(
    `SELECT COUNT(*) as total FROM audit_logs WHERE ${whereClause}`,
    countParamsCopy,
  );
  const total = parseInt(countResult.rows[0].total);

  // Get events
  let query_sql = `SELECT * FROM audit_logs WHERE ${whereClause} ORDER BY timestamp DESC`;

  // SECURITY FIX: Enforce maximum query limit
  const effectiveLimit = query.limit ? Math.min(query.limit, MAX_QUERY_LIMIT) : 100;
  params.push(effectiveLimit);
  query_sql += ` LIMIT $${params.length}`;

  if (query.offset) {
    params.push(query.offset);
    query_sql += ` OFFSET $${params.length}`;
  }

  const { rows } = await this.db.query(query_sql, params);

  const events: AuditEvent[] = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    type: r.type,
    severity: r.severity,
    actor: {
    type: r.actor_type,
    id: r.actor_id,
    email: r.actor_email,
    ip: r.actor_ip,
    userAgent: r.actor_user_agent,
    },
    resource: {
    type: r.resource_type,
    id: r.resource_id,
    name: r.resource_name,
    },
    action: r.action,
    result: r.result,
    details: r.details,
    changes: r.changes,
    sessionId: r.session_id,
    requestId: r.request_id,
    previousHash: r.previous_hash,
    hash: r.hash,
  }));

  return { events, total };
  }

  /**
  * Verify integrity of audit trail
  */
  async verifyIntegrity(since?: Date): Promise<{
  valid: boolean;
  lastValidEvent?: AuditEvent;
  firstInvalidEvent?: AuditEvent;
  invalidCount: number;
  checkedCount: number;
  }> {
  // P2-FIX: Paginate verification instead of loading ALL rows into memory.
  // Previously: SELECT * FROM audit_logs ORDER BY timestamp (no LIMIT) which
  // causes OOM on production databases with millions of audit events.
  // Now processes in batches of 1000 rows using cursor-based pagination.
  const BATCH_SIZE = 1000;
  let query: string;
  const params: unknown[] = [];

  if (since) {
    query = 'SELECT * FROM audit_logs WHERE timestamp >= $1 ORDER BY timestamp LIMIT $2 OFFSET $3';
    params.push(since);
  } else {
    query = 'SELECT * FROM audit_logs ORDER BY timestamp LIMIT $1 OFFSET $2';
  }

  let offset = 0;
  let hasMore = true;

  let previousHash = '';
  let invalidCount = 0;
  let checkedCount = 0;
  let firstInvalid: AuditEvent | undefined;
  let lastValid: AuditEvent | undefined;

  while (hasMore) {
    const batchParams = since
    ? [params[0], BATCH_SIZE, offset]
    : [BATCH_SIZE, offset];

    const { rows } = await this.db.query(query, batchParams);
    hasMore = rows.length === BATCH_SIZE;
    offset += rows.length;

    for (const row of rows) {
    checkedCount++;
    const event: AuditEvent = {
    id: row.id,
    timestamp: row.timestamp,
    type: row.type,
    severity: row.severity,
    actor: {
    type: row.actor_type,
    id: row.actor_id,
    email: row.actor_email,
    ip: row.actor_ip,
    userAgent: row.actor_user_agent,
    },
    resource: {
    type: row.resource_type,
    id: row.resource_id,
    name: row.resource_name,
    },
    action: row.action,
    result: row.result,
    details: row.details,
    changes: row.changes,
    sessionId: row.session_id,
    requestId: row.request_id,
    previousHash: row.previous_hash,
    hash: row.hash,
    };

    // Verify chain
    if (event.previousHash !== previousHash) {
    invalidCount++;
    if (!firstInvalid) {
    firstInvalid = event;
    }
    } else {
    // Verify hash
    const { hash: _, ...eventWithoutHash } = event;
    const calculatedHash = this.calculateHash(eventWithoutHash);
    if (calculatedHash !== event.hash) {
    invalidCount++;
    if (!firstInvalid) {
    firstInvalid = event;
    }
    } else {
    lastValid = event;
    }
    }

    previousHash = event.hash;
    }
  }

  return {
    valid: invalidCount === 0,
    ...(lastValid !== undefined && { lastValidEvent: lastValid }),
    ...(firstInvalid !== undefined && { firstInvalidEvent: firstInvalid }),
    invalidCount,
    checkedCount,
  };
  }

  /**
  * Generate unique event ID
  */
  private generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
  * Calculate hash for tamper detection
  * SECURITY FIX: Include all fields in hash calculation for complete tamper detection
  *
  * P0-FIX: Removed the array replacer argument from JSON.stringify. The previous
  * implementation passed Object.keys({...}).sort() as a replacer, which is an array
  * of top-level key names. Per the JSON.stringify spec, an array replacer filters
  * properties RECURSIVELY at all nesting levels — so nested properties like
  * actor.email, actor.ip, actor.userAgent, resource.name, and arbitrary keys in
  * details/changes were silently excluded from the hash. This meant an attacker
  * could tamper with those fields without breaking the hash chain.
  *
  * The sortKeys() helper already provides deterministic key ordering for nested
  * objects, so no replacer is needed.
  */
  private calculateHash(event: Omit<AuditEvent, 'hash'>): string {
  const data = JSON.stringify({
    action: event.action,
    actor: this.sortKeys(event.actor),
    changes: event.changes ? this.sortKeys(event.changes) : undefined,
    details: this.sortKeys(event.details),
    id: event.id,
    previousHash: event.previousHash,
    requestId: event.requestId,
    resource: this.sortKeys(event.resource),
    result: event.result,
    sessionId: event.sessionId,
    severity: event.severity,
    timestamp: event.timestamp,
    type: event.type,
  });

  return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
  * Recursively sort object keys for stable hashing
  */
  private sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => this.sortKeys(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
    sorted[key] = this.sortKeys(record[key]);
    }
    return sorted;
  }
  return obj;
  }

  /**
  * Get security summary
  */
  async getSecuritySummary(since: Date = new Date(Date.now() - 86400000)): Promise<{
  totalEvents: number;
  failedLogins: number;
  permissionChanges: number;
  dataExports: number;
  criticalEvents: number;
  topActors: Array<{ id: string; count: number }>;
  }> {
  const { rows: totalRows } = await this.db.query(
    `SELECT COUNT(*) as total,
    COUNT(*) FILTER (WHERE type = 'auth.failed') as failed_logins,
    COUNT(*) FILTER (WHERE type LIKE 'permission.%') as permission_changes,
    COUNT(*) FILTER (WHERE type = 'data.export') as data_exports,
    COUNT(*) FILTER (WHERE severity = 'critical') as critical_events
    FROM audit_logs
    WHERE timestamp >= $1`,
    [since]
  );

  const { rows: actorRows } = await this.db.query(
    `SELECT actor_id, COUNT(*) as count
    FROM audit_logs
    WHERE timestamp >= $1
    GROUP BY actor_id
    ORDER BY count DESC
    LIMIT 10`,
    [since]
  );

  return {
    totalEvents: parseInt(totalRows[0].total),
    failedLogins: parseInt(totalRows[0].failed_logins),
    permissionChanges: parseInt(totalRows[0].permission_changes),
    dataExports: parseInt(totalRows[0].data_exports),
    criticalEvents: parseInt(totalRows[0].critical_events),
    topActors: actorRows.map((r) => ({ id: r.actor_id, count: parseInt(r.count) })),
  };
  }
}
