/**
 * Connection Pool Health Monitoring
 * 
 * P2 OPTIMIZATION: Monitors connection pool health and optimizes pool sizing:
 * - Dynamic pool sizing based on load
 * - Connection health checks
 * - Pool exhaustion detection
 * - Connection leak detection
 */

import type { Pool } from 'pg';
import { EventEmitter } from 'events';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PoolHealthConfig {
  /** Initial pool size */
  initialSize?: number;
  /** Minimum pool size */
  minSize?: number;
  /** Maximum pool size */
  maxSize?: number;
  /** Target connection utilization (0-1) */
  targetUtilization?: number;
  /** Health check interval in ms */
  healthCheckIntervalMs?: number;
  /** Connection timeout in ms */
  connectionTimeoutMs?: number;
  /** Enable dynamic sizing */
  dynamicSizing?: boolean;
  /** Scale up threshold (utilization %) */
  scaleUpThreshold?: number;
  /** Scale down threshold (utilization %) */
  scaleDownThreshold?: number;
}

export interface PoolMetrics {
  timestamp: number;
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  utilization: number;
  totalQueries: number;
  slowQueries: number;
  averageQueryTime: number;
  healthStatus: 'healthy' | 'degraded' | 'critical';
}

export interface ConnectionHealth {
  healthy: boolean;
  latency: number;
  lastChecked: number;
  error?: string;
}

export interface PoolHealthStatus {
  status: 'healthy' | 'degraded' | 'critical';
  metrics: PoolMetrics;
  connections: ConnectionHealth[];
  recommendations: string[];
}

// ============================================================================
// Pool Health Monitor
// ============================================================================

export class PoolHealthMonitor extends EventEmitter {
  private pool: Pool;
  private config: Required<PoolHealthConfig>;
  private metrics: PoolMetrics;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private connectionHealth = new Map<string, ConnectionHealth>();
  private queryTimes: number[] = [];
  private queryCount = 0;
  private slowQueryCount = 0;

  constructor(pool: Pool, config: PoolHealthConfig = {}) {
    super();
    this.pool = pool;
    this.config = {
      initialSize: config.initialSize ?? 10,
      minSize: config.minSize ?? 2,
      maxSize: config.maxSize ?? 50,
      targetUtilization: config.targetUtilization ?? 0.7,
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 30000,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 5000,
      dynamicSizing: config.dynamicSizing ?? true,
      scaleUpThreshold: config.scaleUpThreshold ?? 0.8,
      scaleDownThreshold: config.scaleDownThreshold ?? 0.3,
    };

    this.metrics = this.initializeMetrics();
    this.attachPoolListeners();
  }

  private initializeMetrics(): PoolMetrics {
    return {
      timestamp: Date.now(),
      totalConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      utilization: 0,
      totalQueries: 0,
      slowQueries: 0,
      averageQueryTime: 0,
      healthStatus: 'healthy',
    };
  }

  private attachPoolListeners(): void {
    this.pool.on('connect', () => {
      this.emit('connection:connect');
    });

    this.pool.on('acquire', () => {
      this.emit('connection:acquire');
    });

    this.pool.on('remove', () => {
      this.emit('connection:remove');
    });

    this.pool.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      void this.performHealthCheck();
    }, this.config.healthCheckIntervalMs).unref();

    this.emit('monitoring:started');
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.emit('monitoring:stopped');
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // Check pool metrics
      const totalConnections = this.pool.totalCount;
      const idleConnections = this.pool.idleCount;
      const waitingClients = this.pool.waitingCount;
      const activeConnections = totalConnections - idleConnections;
      const utilization = totalConnections > 0 ? activeConnections / totalConnections : 0;

      // Update metrics
      this.metrics = {
        timestamp: Date.now(),
        totalConnections,
        idleConnections,
        waitingClients,
        utilization,
        totalQueries: this.queryCount,
        slowQueries: this.slowQueryCount,
        averageQueryTime: this.calculateAverageQueryTime(),
        healthStatus: this.determineHealthStatus(utilization, waitingClients),
      };

      // Check connection health
      await this.checkConnectionHealth();

      // Dynamic pool sizing
      if (this.config.dynamicSizing) {
        await this.adjustPoolSize(utilization, waitingClients);
      }

      // Emit metrics
      this.emit('metrics', this.metrics);

      // Check for alerts
      this.checkAlerts(utilization, waitingClients);

    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Check connection health
   */
  private async checkConnectionHealth(): Promise<void> {
    const client = await this.pool.connect();
    const startTime = Date.now();
    
    try {
      await client.query('SELECT 1');
      const latency = Date.now() - startTime;
      
      this.connectionHealth.set('main', {
        healthy: true,
        latency,
        lastChecked: Date.now(),
      });

      if (latency > 100) {
        this.emit('warning', `High connection latency: ${latency}ms`);
      }
    } catch (error) {
      this.connectionHealth.set('main', {
        healthy: false,
        latency: Date.now() - startTime,
        lastChecked: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.emit('error', error);
    } finally {
      client.release();
    }
  }

  /**
   * Determine health status based on metrics
   */
  private determineHealthStatus(utilization: number, waitingClients: number): 'healthy' | 'degraded' | 'critical' {
    if (waitingClients > 10 || utilization > 0.95) {
      return 'critical';
    }
    if (waitingClients > 5 || utilization > 0.8) {
      return 'degraded';
    }
    return 'healthy';
  }

  /**
   * Emit pool-sizing recommendations based on current utilization.
   *
   * NOTE: `pg.Pool` does NOT support live resizing — setting `pool.options.max`
   * on a running Pool has NO effect (the pool reads the option only at
   * construction time).  Emitting events lets the application layer decide
   * whether to drain and recreate the pool or simply log the advisory.
   * The previous code set `this.pool.options.max = newMax` and called the
   * event 'pool:scaledUp', giving a false impression that resizing had occurred.
   */
  private async adjustPoolSize(utilization: number, waitingClients: number): Promise<void> {
    const currentMax = this.pool.options.max;

    // Scale-up advisory: high utilization with queued clients
    if (utilization > this.config.scaleUpThreshold && waitingClients > 0) {
      const recommendedMax = Math.min(currentMax + 5, this.config.maxSize);
      if (recommendedMax > currentMax) {
        this.emit('pool:scaleUpRecommended', { current: currentMax, recommended: recommendedMax });
      }
    }

    // Scale-down advisory: sustained low utilization
    if (utilization < this.config.scaleDownThreshold && currentMax > this.config.minSize) {
      const recommendedMax = Math.max(currentMax - 2, this.config.minSize);
      if (recommendedMax < currentMax) {
        this.emit('pool:scaleDownRecommended', { current: currentMax, recommended: recommendedMax });
      }
    }
  }

  /**
   * Check for alert conditions
   */
  private checkAlerts(utilization: number, waitingClients: number): void {
    if (waitingClients > 5) {
      this.emit('alert', {
        severity: 'warning',
        message: `${waitingClients} clients waiting for connection`,
        metric: 'waitingClients',
        value: waitingClients,
      });
    }

    if (utilization > 0.9) {
      this.emit('alert', {
        severity: 'critical',
        message: `Pool utilization at ${(utilization * 100).toFixed(1)}%`,
        metric: 'utilization',
        value: utilization,
      });
    }
  }

  /**
   * Record query execution time
   */
  recordQueryTime(durationMs: number): void {
    this.queryCount++;
    this.queryTimes.push(durationMs);

    if (durationMs > 1000) {
      this.slowQueryCount++;
    }

    // Keep only recent query times
    if (this.queryTimes.length > 1000) {
      this.queryTimes.shift();
    }
  }

  /**
   * Calculate average query time
   */
  private calculateAverageQueryTime(): number {
    if (this.queryTimes.length === 0) return 0;
    const sum = this.queryTimes.reduce((a, b) => a + b, 0);
    return sum / this.queryTimes.length;
  }

  /**
   * Get current metrics
   */
  getMetrics(): PoolMetrics {
    return { ...this.metrics };
  }

  /**
   * Get health status
   */
  getHealthStatus(): PoolHealthStatus {
    const recommendations: string[] = [];

    if (this.metrics.utilization > 0.8) {
      recommendations.push('Consider increasing pool size or optimizing queries');
    }

    if (this.metrics.waitingClients > 5) {
      recommendations.push('High wait queue - pool may be undersized');
    }

    if (this.metrics.averageQueryTime > 500) {
      recommendations.push('High average query time - consider query optimization');
    }

    return {
      status: this.metrics.healthStatus,
      metrics: this.metrics,
      connections: [...this.connectionHealth.values()],
      recommendations,
    };
  }

  /**
   * Get optimal pool size recommendation
   */
  getOptimalPoolSize(): number {
    const currentMax = this.pool.options.max;
    const utilization = this.metrics.utilization;

    if (utilization > 0.8) {
      return Math.min(Math.ceil(currentMax * 1.5), this.config.maxSize);
    }

    if (utilization < 0.3 && currentMax > this.config.minSize) {
      return Math.max(Math.floor(currentMax * 0.8), this.config.minSize);
    }

    return currentMax;
  }

  /**
   * Check if pool is healthy
   */
  isHealthy(): boolean {
    return this.metrics.healthStatus === 'healthy';
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.queryCount = 0;
    this.slowQueryCount = 0;
    this.queryTimes = [];
    this.connectionHealth.clear();
    this.metrics = this.initializeMetrics();
  }
}

// ============================================================================
// Connection Leak Detector
// ============================================================================

export class ConnectionLeakDetector {
  private activeConnections = new Map<string, {
    acquiredAt: number;
    stack: string;
  }>();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private pool: Pool,
    private options: {
      leakThresholdMs?: number;
      checkIntervalMs?: number;
      onLeak?: (info: { id: string; duration: number; stack: string }) => void;
    } = {}
  ) {}

  /**
   * Start leak detection
   */
  start(): void {
    const { leakThresholdMs = 30000, checkIntervalMs = 10000 } = this.options;

    this.checkInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [id, info] of this.activeConnections) {
        const duration = now - info.acquiredAt;
        
        if (duration > leakThresholdMs) {
          this.options.onLeak?.({ id, duration, stack: info.stack });
        }
      }
    }, checkIntervalMs).unref();
  }

  /**
   * Stop leak detection
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Track connection acquisition
   */
  trackAcquisition(connectionId: string): void {
    this.activeConnections.set(connectionId, {
      acquiredAt: Date.now(),
      stack: new Error().stack || '',
    });
  }

  /**
   * Track connection release
   */
  trackRelease(connectionId: string): void {
    this.activeConnections.delete(connectionId);
  }

  /**
   * Get active connection count
   */
  getActiveCount(): number {
    return this.activeConnections.size;
  }
}

// ============================================================================
// Pool Sizing Recommendations
// ============================================================================

export const poolSizingGuide = {
  /**
   * Calculate recommended pool size based on workload
   */
  calculateRecommendedSize(params: {
    concurrentRequests: number;
    averageQueryTimeMs: number;
    requestDurationMs: number;
    cpuCores: number;
  }): number {
    const { concurrentRequests, averageQueryTimeMs, requestDurationMs, cpuCores } = params;

    // Little's Law: L = λ * W
    // Connections = Throughput * Response Time
    const connectionsNeeded = Math.ceil(
      (concurrentRequests * averageQueryTimeMs) / requestDurationMs
    );

    // Add headroom for bursts
    const withHeadroom = Math.ceil(connectionsNeeded * 1.5);

    // Don't exceed reasonable limits per CPU
    const maxPerCpu = 10;
    const maxConnections = cpuCores * maxPerCpu;

    return Math.min(withHeadroom, maxConnections);
  },

  /**
   * Recommended pool sizes by environment
   */
  recommendedSizes: {
    development: { min: 2, max: 10 },
    testing: { min: 1, max: 5 },
    staging: { min: 5, max: 20 },
    production: { min: 10, max: 50 },
  },

  /**
   * Pool sizing formula explanation
   */
  formula: `
Recommended Pool Size = (Concurrent Requests × Avg Query Time) / Request Duration

Example:
- 100 concurrent requests
- 50ms average query time
- 200ms request duration
- Pool Size = (100 × 50) / 200 = 25 connections

Add 50% headroom for burst traffic: 25 × 1.5 = 38 connections
`,
};

// ============================================================================
// Health Check Utilities
// ============================================================================

export async function checkDatabaseHealth(
  pool: Pool,
  timeoutMs = 5000
): Promise<{ healthy: boolean; latency: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    const client = await pool.connect();
    try {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        client.query('SELECT 1'),
        new Promise((_, reject) => {
          timerId = setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
        }),
      ]).finally(() => {
        if (timerId !== undefined) clearTimeout(timerId);
      });

      return {
        healthy: true,
        latency: Date.now() - startTime,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getPoolStats(pool: Pool): Promise<{
  total: number;
  idle: number;
  waiting: number;
}> {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}
