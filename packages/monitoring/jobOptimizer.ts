import { LRUCache } from '../utils/lruCache';

import { EventEmitter } from 'events';

import { getLogger } from '@kernel/logger';
const logger = getLogger('job-optimizer');


/**
* Job Coalescing & Intelligent Scheduling
* Optimizes job execution by coalescing similar jobs and smart scheduling
*/

export type JobPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

/** Job data payload - generic record for flexibility with type safety */
export type JobData = Record<string, unknown>;

/** Scheduler options for job scheduling */
export interface ScheduleOptions {
  priority?: JobPriority;
  delay?: number;
  jobId?: string;
}

/** Queue metrics returned by scheduler */
export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

// Interface to avoid direct dependency on apps/api
export interface IJobScheduler {
  schedule(name: string, data: JobData, options?: ScheduleOptions): Promise<unknown>;
  getMetrics(queueName: string): Promise<QueueMetrics>;
}

/**
* Rule for coalescing similar jobs
*/
export interface CoalescingRule {
  jobName: string;
  keyExtractor: (data: unknown) => string;
  windowMs: number;
  mergeStrategy: 'replace' | 'combine' | 'discard';
}

export interface ScheduledWindow {
  startHour: number;
  endHour: number;
  priority: JobPriority;
  maxConcurrent: number;
}

export interface JobDependency {
  jobName: string;
  dependsOn: string[];
  parallel: boolean;
}

export class JobOptimizer extends EventEmitter {
  private readonly scheduler: IJobScheduler;
  // P1-4 FIX: Use a plain Map instead of LRUCache for pendingJobs. LRUCache silently
  // evicts entries without calling clearTimeout on the stored timeout handles, causing
  // both timer leaks and ghost job scheduling from stale data.
  private readonly pendingJobs = new Map<string, { data: unknown; timeout: NodeJS.Timeout }>();
  private readonly MAX_PENDING_JOBS = 10000;
  private readonly coalescingRules = new LRUCache<string, CoalescingRule>({ maxSize: 1000, ttlMs: undefined });
  private scheduledWindows: ScheduledWindow[] = [];
  private readonly dependencies = new LRUCache<string, JobDependency>({ maxSize: 1000, ttlMs: undefined });
  private readonly completedJobs = new LRUCache<string, Date>({ maxSize: 5000, ttlMs: 3600000 }); // For dependency tracking

  constructor(scheduler: IJobScheduler) {
  super();
  this.scheduler = scheduler;
  this.setupDefaultRules();
  this.setupDefaultWindows();
  }

  /**
  * Setup default coalescing rules
  */
  // P2-12 FIX: Safe property access helper to replace unsafe `(data as X).prop` casts
  private static safeGet(data: unknown, key: string, fallback = 'unknown'): string {
    if (data && typeof data === 'object' && key in data) {
      return String((data as Record<string, unknown>)[key]);
    }
    return fallback;
  }

  private setupDefaultRules(): void {
  // Coalesce keyword fetches for same domain
  // P2-12 FIX: Use safe property access instead of unsafe type casts
  this.registerCoalescingRule({
    jobName: 'keyword-fetch',
    keyExtractor: (data) => `domain:${JobOptimizer.safeGet(data, 'domainId')}`,
    windowMs: 60000, // 1 minute
    mergeStrategy: 'replace',
  });

  // Coalesce content idea generation for same domain
  this.registerCoalescingRule({
    jobName: 'content-idea-generation',
    keyExtractor: (data) => `domain:${JobOptimizer.safeGet(data, 'domainId')}:type:${JobOptimizer.safeGet(data, 'contentType')}`,
    windowMs: 300000, // 5 minutes
    mergeStrategy: 'combine',
  });

  // Coalesce image generation requests
  this.registerCoalescingRule({
    jobName: 'image-generation',
    keyExtractor: (data) => `org:${JobOptimizer.safeGet(data, 'orgId')}:style:${JobOptimizer.safeGet(data, 'style', 'default')}`,
    windowMs: 10000, // 10 seconds
    mergeStrategy: 'combine',
  });

  // Coalesce analytics sync
  this.registerCoalescingRule({
    jobName: 'analytics-sync',
    keyExtractor: (data) => `domain:${JobOptimizer.safeGet(data, 'domainId')}`,
    windowMs: 300000, // 5 minutes
    mergeStrategy: 'discard',
  });
  }

  /**
  * Setup default scheduled windows
  */
  private setupDefaultWindows(): void {
  this.scheduledWindows = [
    // Off-peak hours - background jobs
    { startHour: 0, endHour: 6, priority: 'background', maxConcurrent: 10 },
    // Morning - normal priority
    { startHour: 6, endHour: 9, priority: 'normal', maxConcurrent: 5 },
    // Business hours - be conservative
    { startHour: 9, endHour: 17, priority: 'normal', maxConcurrent: 3 },
    // Evening - high priority allowed
    { startHour: 17, endHour: 22, priority: 'high', maxConcurrent: 5 },
    // Late evening - normal
    { startHour: 22, endHour: 24, priority: 'normal', maxConcurrent: 5 },
  ];
  }

  /**
  * Register a coalescing rule
  * @param rule - Coalescing rule to register
  */
  registerCoalescingRule(rule: CoalescingRule): void {
  this.coalescingRules.set(rule.jobName, rule);
  }

  /**
  * Schedule a job with coalescing
  */
  async scheduleWithCoalescing(
  jobName: string,
  data: JobData,
  options: { priority?: JobPriority; delay?: number } = {}
  ): Promise<void> {
  const rule = this.coalescingRules.get(jobName);

  if (!rule) {
    // No coalescing rule, schedule immediately
    await this.scheduler.schedule(jobName, data, options);
    return;
  }

  const key = `${jobName}:${rule.keyExtractor(data)}`;
  const existing = this.pendingJobs.get(key);

  if (existing) {
    // Job already pending, apply merge strategy
    switch (rule.mergeStrategy) {
    case 'replace':
    // Clear existing timeout and set new one
    clearTimeout(existing.timeout);
    this.scheduleCoalesced(key, jobName, data, rule.windowMs);
    this.emit('coalesced', { jobName, key, strategy: 'replace' });
    break;

    case 'combine': {
    // Merge data
    const mergedData = this.mergeData(existing["data"] as JobData, data as JobData);
    clearTimeout(existing.timeout);
    this.scheduleCoalesced(key, jobName, mergedData, rule.windowMs);
    this.emit('coalesced', { jobName, key, strategy: 'combine' });
    break;
    }

    case 'discard':
    // Don't schedule new job
    this.emit('coalesced', { jobName, key, strategy: 'discard' });
    return;
    }
  } else {
    // Schedule new coalesced job
    this.scheduleCoalesced(key, jobName, data, rule.windowMs);
  }
  }

  /**
  * Schedule a coalesced job
  */
  private scheduleCoalesced(
  key: string,
  jobName: string,
  data: JobData,
  windowMs: number
  ): void {
  // P1-4 FIX: Clear timeout of existing entry before overwriting to prevent leak
  const existing = this.pendingJobs.get(key);
  if (existing) {
    clearTimeout(existing.timeout);
  }

  // P1-FIX: Enforce max size with proper timeout cleanup on eviction.
  // P1-FIX: Log eviction so silently-dropped jobs are visible in observability.
  if (this.pendingJobs.size >= this.MAX_PENDING_JOBS && !this.pendingJobs.has(key)) {
    // Evict oldest entry (first key in Map insertion order)
    const oldestKey = this.pendingJobs.keys().next().value;
    if (oldestKey !== undefined) {
      const oldEntry = this.pendingJobs.get(oldestKey);
      if (oldEntry) clearTimeout(oldEntry.timeout);
      this.pendingJobs.delete(oldestKey);
      logger.warn('Pending job evicted due to capacity limit', {
        evictedKey: oldestKey,
        incomingKey: key,
        maxPendingJobs: this.MAX_PENDING_JOBS,
      });
      this.emit('jobEvicted', { evictedKey: oldestKey });
    }
  }

  // P1-3 FIX: Add .catch() to prevent unhandled promise rejection from crashing
  // the process. Previously, if schedule() threw inside the async setTimeout
  // callback, it was an unhandled rejection (process crash in Node 15+).
  const timeout = setTimeout(() => {
    this.pendingJobs.delete(key);
    this.scheduler.schedule(jobName, data).catch(err => {
      logger.error('Failed to schedule coalesced job', undefined, {
        jobName,
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      this.emit('coalescingError', { jobName, key, error: err });
    });
  }, windowMs);

  this.pendingJobs.set(key, { data, timeout });
  }

  /**
   * Merge job data.
   *
   * P1-FIX: The array branch previously returned `[...a, ...b] as unknown as JobData`.
   * JobData is `Record<string, unknown>`, not an array, so the double cast was a type
   * lie that caused runtime failures when downstream code treated the result as an
   * object (e.g. `Object.entries`, `data['key']`). Arrays are now wrapped in an
   * object to maintain the Record<string,unknown> contract.
   */
  private mergeData(existing: JobData, incoming: JobData): JobData {
    // Arrays: wrap in an object with an `items` key to preserve Record shape
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      return { items: [...existing, ...incoming] };
    }

    if (typeof existing === 'object' && typeof incoming === 'object') {
      return { ...existing, ...incoming };
    }

    return incoming;
  }

  /**
  * Get optimal priority based on time of day
  * @param requestedPriority - Priority requested by caller
  * @returns Optimal priority for current time
  */
  getOptimalPriority(requestedPriority?: JobPriority): JobPriority {
  const hour = new Date().getHours();

  for (const window of this.scheduledWindows) {
    if (hour >= window.startHour && hour < window.endHour) {
    // If requested priority is higher than window allows, use requested
    const priorityLevels: JobPriority[] = ['background', 'low', 'normal', 'high', 'critical'];
    const windowIndex = priorityLevels.indexOf(window.priority);
    const requestedIndex = requestedPriority
    ? priorityLevels.indexOf(requestedPriority)
    : -1;

    if (requestedIndex > windowIndex) {
    return requestedPriority!;
    }

    return window.priority;
    }
  }

  return requestedPriority || 'normal';
  }

  /**
  * Schedule with intelligent priority
  */
  async scheduleIntelligent(
  jobName: string,
  data: JobData,
  options: { priority?: JobPriority; delay?: number } = {}
  ): Promise<void> {
  const optimalPriority = this.getOptimalPriority(options.priority);

  // Adjust delay based on load
  const queueMetrics = await this.scheduler.getMetrics(
    this.getQueueForJob(jobName)
  );

  let delay = options.delay || 0;

  // If queue is backed up, add delay
  if (queueMetrics.waiting > 50) {
    delay += 60000; // Add 1 minute
  }

  // P1-6 FIX: Pass computed delay to scheduleWithCoalescing. Previously the
  // load-based delay was computed but never passed, making the entire
  // backpressure mechanism dead code.
  await this.scheduleWithCoalescing(jobName, data, {
    priority: optimalPriority,
    delay,
  });
  }

  /**
  * Register job dependencies
  */
  registerDependency(jobName: string, dependsOn: string[], parallel: boolean = false): void {
  this.dependencies.set(jobName, { jobName, dependsOn, parallel });
  }

  /**
  * Schedule job with dependency resolution
  */
  async scheduleWithDependencies(
  jobName: string,
  data: JobData,
  options: { priority?: JobPriority } = {}
  ): Promise<void> {
  const dependency = this.dependencies.get(jobName);

  if (!dependency || dependency.dependsOn.length === 0) {
    // No dependencies, schedule normally
    await this.scheduleIntelligent(jobName, data, options);
    return;
  }

  // Check if dependencies are met
  const unmetDeps = dependency.dependsOn.filter(
    (dep) => {
    const completedTime = this.completedJobs.get(dep);
    if (!completedTime) return true;
    return Date.now() - completedTime.getTime() > 3600000; // 1 hour stale
    }
  );

  if (unmetDeps.length === 0) {
    // All dependencies met
    await this.scheduleIntelligent(jobName, data, options);
  } else {
    // Schedule dependencies first
    this.emit('dependencyWait', { jobName, waitingFor: unmetDeps });

    // In a real implementation, you'd set up listeners for dependency completion
    // For now, schedule with delay
    await this.scheduleIntelligent(jobName, data, {
    ...options,
    delay: 60000, // 1 minute delay
    });
  }
  }

  /**
  * Mark job as completed (for dependency tracking)
  */
  markCompleted(jobName: string): void {
  this.completedJobs.set(jobName, new Date());

  // Clean up old entries
  const oneHourAgo = new Date(Date.now() - 3600000);
  for (const [name, time] of this.completedJobs.entries()) {
    if (time < oneHourAgo) {
    this.completedJobs.delete(name);
    }
  }
  }

  /**
  * Batch schedule similar jobs
  */
  async batchSchedule(
  jobName: string,
  items: JobData[],
  batchSize: number = 10
  ): Promise<void> {
  // Group items by coalescing key
  const rule = this.coalescingRules.get(jobName);
  const groups = new Map<string, JobData[]>();

  if (rule) {
    for (const item of items) {
    const key = rule.keyExtractor(item);
    const group = groups.get(key);
    if (group) {
    group.push(item);
    } else {
    groups.set(key, [item]);
    }
    }
  } else {
    groups.set('default', items);
  }

  // Schedule batches
  for (const [_key, groupItems] of groups) {
    for (let i = 0; i < groupItems.length; i += batchSize) {
    const batch = groupItems.slice(i, i + batchSize);
    await this.scheduleWithCoalescing(
    jobName,
    batch as unknown as JobData,
    { priority: 'background' }
    );
    }
  }
  }

  /**
  * Get queue name for job
  */
  private getQueueForJob(jobName: string): string {
  const queueMap: Record<string, string> = {
    'content-idea-generation': 'ai-tasks',
    'image-generation': 'ai-tasks',
    'keyword-fetch': 'analytics',
    'social-sync': 'analytics',
    'domain-export': 'low_priority_exports',
    'publish-execution': 'publishing',
  };

  return queueMap[jobName] || 'default';
  }

  /**
  * Get optimization stats
  */
  getStats(): {
  pendingCoalesced: number;
  coalescingRules: number;
  completedDependencies: number;
  } {
  return {
    pendingCoalesced: this.pendingJobs.size,
    coalescingRules: this.coalescingRules.size,
    completedDependencies: this.completedJobs.size,
  };
  }

  /**
  * Clear all pending coalesced jobs
  */
  flush(): void {
  for (const key of this.pendingJobs.keys()) {
    const entry = this.pendingJobs.get(key);
    if (entry) {
    clearTimeout(entry.timeout);
    }
  }
  this.pendingJobs.clear();
  }
}
