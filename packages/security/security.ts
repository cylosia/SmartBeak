import { EventEmitter } from 'events';

import { getLogger, getRequestContext } from '@kernel/logger';

import { LRUCache } from '../utils/lruCache';

import crypto from 'crypto';


/**
* Security Utilities
* Additional security features: Session management, device tracking, alerting

*/

// SECURITY FIX: Session limits - enforce concurrent session limit
export interface SessionRecord {
  userId: string;
  sessionId: string;
  orgId: string;
  createdAt: number;
  lastActivity: number;
  deviceInfo?: DeviceInfo;
}

export interface DeviceInfo {
  userAgent: string;
  ip: string;
  fingerprint: string;
}

export interface SecurityAlert {
  id: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: SecurityAlertType;
  userId?: string;
  orgId?: string;
  message: string;
  details: Record<string, unknown>;
}

export type SecurityAlertType =
  | 'suspicious_login'
  | 'multiple_failed_attempts'
  | 'privilege_escalation'
  | 'token_reuse'
  | 'rate_limit_exceeded'
  | 'concurrent_session_limit'
  | 'unusual_activity';

/**
* Session Manager - enforces concurrent session limits
* SECURITY FIX: Session limits implementation

*/
export class SessionManager extends EventEmitter {
  private sessions = new LRUCache<string, SessionRecord>({ maxSize: 10000, ttlMs: 86400000 });
  private userSessions = new LRUCache<string, Set<string>>({ maxSize: 10000, ttlMs: 86400000 });
  private readonly maxConcurrentSessions: number;

  constructor(maxConcurrentSessions: number = 5) {
  super();
  this.maxConcurrentSessions = maxConcurrentSessions;
  }

  /**
  * Register a new session
  * SECURITY FIX: Enforce concurrent session limit
  */
  registerSession(
  userId: string,
  sessionId: string,
  orgId: string,
  deviceInfo?: DeviceInfo
  ): boolean {
  const userSessionIds = this.userSessions.get(userId) || new Set();

  // Check if user has reached session limit
  if (userSessionIds.size >= this.maxConcurrentSessions) {
    this.emit('sessionLimitExceeded', {
    currentSessions: userSessionIds.size,
    maxSessions: this.maxConcurrentSessions,
    });
    return false;
  }

  const session: SessionRecord = {
    userId,
    sessionId,
    orgId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    ...(deviceInfo && { deviceInfo })
  };

  this.sessions.set(sessionId, session);
  userSessionIds.add(sessionId);
  this.userSessions.set(userId, userSessionIds);

  this.emit('sessionCreated', { userId, sessionId, orgId });
  return true;
  }

  /**
  * Update session activity
  */
  updateActivity(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
  }
  }

  /**
  * Terminate a session
  */
  terminateSession(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (session) {
    this.sessions.delete(sessionId);
    const userSessions = this.userSessions.get(session["userId"]);
    if (userSessions) {
    userSessions.delete(sessionId);
    if (userSessions.size === 0) {
    this.userSessions.delete(session["userId"]);
    }
    }
    this.emit('sessionTerminated', { sessionId, userId: session["userId"] });
  }
  }

  /**
  * Get active sessions for a user
  */
  getUserSessions(userId: string): SessionRecord[] {
  const sessionIds = this.userSessions.get(userId);
  if (!sessionIds) return [];
  return [...sessionIds]
    .map(id => this.sessions.get(id))
    .filter((s): s is SessionRecord => s !== undefined);
  }

  /**
  * Clean up expired sessions
  * SECURITY FIX: Add TTL to session entries to prevent memory leak

  */
  cleanupExpiredSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  // LRUCache handles TTL automatically, but we also check lastActivity for session-specific logic
  for (const sessionId of this.sessions.keys()) {
    const session = this.sessions.get(sessionId);
    if (session && now - session.lastActivity > maxAgeMs) {
    this.terminateSession(sessionId);
    cleaned++;
    }
  }

  return cleaned;
  }
}

/**
* Security Alert Manager
* SECURITY FIX: Real-time security alerting
*/
export class SecurityAlertManager extends EventEmitter {
  private alerts: SecurityAlert[] = [];
  private alertHandlers: Array<(alert: SecurityAlert) => void | Promise<void>> = [];
  private readonly maxAlerts: number = 10000;
  private readonly logger = getLogger('SecurityAlertManager');

  /**
  * Register an alert handler
  */
  onAlert(handler: (alert: SecurityAlert) => void | Promise<void>): void {
  this.alertHandlers.push(handler);
  }

  /**
  * Trigger a security alert
  * SECURITY FIX: Real-time security alerting
  */
  async triggerAlert(
  severity: SecurityAlert['severity'],
  type: SecurityAlertType,
  message: string,
  details: Record<string, unknown> = {},
  userId?: string,
  orgId?: string
  ): Promise<void> {
  const alert: SecurityAlert = {
    id: generateAlertId(),
    timestamp: new Date(),
    severity,
    type,
    message,
    details,
    ...(userId && { userId }),
    ...(orgId && { orgId })
  };

  // Store alert (with limit)
  this.alerts.push(alert);
  if (this.alerts.length > this.maxAlerts) {
    this.alerts.shift(); // Remove oldest
  }

  const ctx = getRequestContext();
  this.logger.warn('Security alert triggered', {
    alertId: alert.id,
    correlationId: ctx?.requestId,
  });

  // Emit for real-time monitoring
  this.emit('alert', alert);

  // Notify all registered handlers
  for (const handler of this.alertHandlers) {
    try {
    await handler(alert);
    } catch (error) {
    this.logger["error"](
    'Security alert handler error',
    error instanceof Error ? error : undefined,
    { alertId: alert.id }
    );
    }
  }
  }

  /**
  * Get recent alerts
  */
  getAlerts(
  options: {
    severity?: SecurityAlert['severity'];
    type?: SecurityAlertType;
    userId?: string;
    since?: Date;
    limit?: number;
  } = {}
  ): SecurityAlert[] {
  let filtered = this.alerts;

  if (options.severity) {
    filtered = filtered.filter(a => a.severity === options.severity);
  }
  if (options.type) {
    filtered = filtered.filter(a => a.type === options.type);
  }
  if (options["userId"]) {
    filtered = filtered.filter(a => a["userId"] === options["userId"]);
  }
  if (options.since) {
    // P2-FIX: Use local const to narrow type for the closure — avoids the `!` non-null
    // assertion which is a code smell flagged by strict TypeScript linting.
    const since = options.since;
    filtered = filtered.filter(a => a.timestamp >= since);
  }

  const limit = options.limit || 100;
  return filtered.slice(-limit);
  }

  /**
  * Check for suspicious patterns
  */
  checkSuspiciousActivity(
  userId: string,
  event: { type: string; ip: string; userAgent: string }
  ): void {
  const userAlerts = this.alerts.filter(
    a => a["userId"] === userId && a.timestamp > new Date(Date.now() - 3600000) // Last hour
  );

  // Check for multiple failed attempts
  const failedAttempts = userAlerts.filter(
    a => a.type === 'multiple_failed_attempts'
  ).length;

  if (failedAttempts >= 5) {
    void this.triggerAlert(
    'high',
    'multiple_failed_attempts',
    `User ${userId} has ${failedAttempts} failed attempts in the last hour`,
    // P1-FIX: Removed `recentEvents: userAlerts` — full alert objects contain IPs,
    // device fingerprints, and event details that constitute PII. Only log the count.
    { failedAttempts },
    );
  }

  // Check for unusual IP — guard against non-string detail values
  const knownIPs = new Set<string>(
    this.alerts
    .filter(a => a["userId"] === userId && typeof a.details?.["ip"] === 'string')
    .map(a => a.details["ip"] as string)
  );

  if (knownIPs.size > 0 && !knownIPs.has(event["ip"])) {
    void this.triggerAlert(
    'medium',
    'suspicious_login',
    // P1-FIX: Do not include knownIps list in alert — it exposes a history of the
    // user's IP addresses (PII). Record only the fact of a new-IP login.
    `Login from new IP address`,
    { newIpHash: this.hashIp(event["ip"]) },
    );
  }
  }

  /**
   * Hash an IP address for logging (one-way, not reversible)
   * Used to record IP events without storing raw PII.
   */
  private hashIp(ip: string): string {
    return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  }
}

/**
* Generate device fingerprint for tracking
* SECURITY FIX: Device tracking for audit logs
*/
export function generateDeviceFingerprint(userAgent: string, ip: string): string {
  const data = `${userAgent}:${ip}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/**
* Generate unique alert ID
*/
function generateAlertId(): string {
  return `alert_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// Export singleton instances for global use

const sessionManagerInstance = new SessionManager();
const securityAlertManagerInstance = new SecurityAlertManager();

export const sessionManager = Object.freeze(sessionManagerInstance) as SessionManager;
export const securityAlertManager = Object.freeze(securityAlertManagerInstance) as SecurityAlertManager;
