import { Pool } from 'pg';

import { DLQService, RegionWorker } from '@kernel/queue';
import { EventBus } from '@kernel/event-bus';
import { getLogger } from '../../packages/kernel/logger';

import { BillingService } from './billing';
import { CostTracker } from '../../packages/monitoring/costTracker';
import { DeliveryAdapter } from '../../domains/notifications/application/ports/DeliveryAdapter';
import { DomainOwnershipService } from './domain-ownership';
import { FacebookAdapter } from '../adapters/facebook/FacebookAdapter';
import { LinkedInAdapter } from '../adapters/linkedin/LinkedInAdapter';
import { NotificationWorker } from '../../domains/notifications/application/NotificationWorker';
import { PostgresNotificationAttemptRepository } from '../../domains/notifications/infra/persistence/PostgresNotificationAttemptRepository';
import { PostgresNotificationDLQRepository } from '../../domains/notifications/infra/persistence/PostgresNotificationDLQRepository';
import { PostgresNotificationPreferenceRepository } from '../../domains/notifications/infra/persistence/PostgresNotificationPreferenceRepository';
import { PostgresNotificationRepository } from '../../domains/notifications/infra/persistence/PostgresNotificationRepository';
import { PostgresPublishAttemptRepository } from '../../domains/publishing/infra/persistence/PostgresPublishAttemptRepository';
import { PostgresPublishingJobRepository } from '../../domains/publishing/infra/persistence/PostgresPublishingJobRepository';
import { PostgresSearchDocumentRepository } from '../../domains/search/infra/persistence/PostgresSearchDocumentRepository';
import { PostgresContentRepository } from '../../domains/content/infra/persistence/PostgresContentRepository';
import { PublishingWorker } from '../../domains/publishing/application/PublishingWorker';
import { SearchIndexingWorker } from '../../domains/search/application/SearchIndexingWorker';
import { UsageService } from './usage';

import Redis from 'ioredis';

const logger = getLogger('ContainerService');

/**

* Dependency Injection Container
* Provides centralized dependency wiring for application services
*/

export interface ContainerConfig {
  dbPool: Pool;
  redisUrl?: string;
}

export interface PublishResult {
  id: string;
}

export interface PublishAdapter {
  publish: (input: { domainId: string; contentId: string; targetConfig: unknown }) => Promise<PublishResult>;
}

export interface EmailMessage {
  to?: string;
  subject?: string;
  body?: string;
  [key: string]: unknown;
}

export interface SlackMessage {
  channel?: string;
  text?: string;
  blocks?: unknown[];
  [key: string]: unknown;
}

export class Container {
  // P1-5 FIX: Use a plain Map for singletons — they should never expire.
  // Previously used LRUCache with 1hr TTL which evicted singletons (Redis, EventBus)
  // causing orphaned connections and resource leaks after 1 hour of uptime.
  private instances = new Map<string, object>();
  private config: ContainerConfig;

  constructor(config: ContainerConfig) {
  this.config = config;
  }

  /**
  * Get or create a singleton instance
  */
  private get<T extends object>(key: string, factory: () => T): T {
  let instance = this.instances.get(key);
  if (instance === undefined) {
    instance = factory();
    this.instances.set(key, instance);
  }
  return instance as T;
  }

  /**
  * Database Pool
  */
  get db(): Pool {
  return this.config.dbPool;
  }

  /**
  * Redis Client
  */
  get redis(): Redis {
  return this.get('redis', () => {
    const redisUrl = this.config.redisUrl || process.env['REDIS_URL'];
    if (!redisUrl) {
    throw new Error('Redis URL is required: set REDIS_URL environment variable or pass redisUrl in ContainerConfig');
    }

    const redis = new Redis(redisUrl, {
    retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true, // Don't connect immediately
    });

    redis.on('error', (err: Error) => {
    logger.error('Redis connection error', err);
    });

    redis.on('connect', () => {
    logger.info('Redis connected');
    });

    return redis;
  });
  }

  /**
  * Event Bus
  */
  get eventBus(): EventBus {
  return this.get('eventBus', () => new EventBus());
  }

  /**
  * Core Services
  */
  get billingService(): BillingService {
  return this.get('billingService', () => new BillingService(this.db));
  }

  get costTracker(): CostTracker {
  return this.get('costTracker', () => new CostTracker(this.db));
  }

  get usageService(): UsageService {
  return this.get('usageService', () => new UsageService(this.db));
  }

  get dlqService(): DLQService {
  return this.get('dlqService', () => new DLQService(this.db));
  }

  get regionWorker(): RegionWorker {
  return this.get('regionWorker', () => new RegionWorker(
    process.env['REGION'] || 'us-east-1'
  ));
  }

  get domainOwnershipService(): DomainOwnershipService {
  return this.get('domainOwnershipService', () => new DomainOwnershipService(this.db));
  }

  /**
  * Publishing Worker
  */
  get publishingWorker(): PublishingWorker {
  return this.get('publishingWorker', () => {
    const jobRepo = new PostgresPublishingJobRepository(this.db);
    const attemptRepo = new PostgresPublishAttemptRepository(this.db);

    // Create adapter based on configuration
    const adapter = this.createPublishAdapter();

    return new PublishingWorker(
    jobRepo,
    attemptRepo,
    adapter,
    this.eventBus,
    this.dlqService,
    this.regionWorker,
    this.db,
    );
  });
  }

  /**
  * Notification Worker
  */
  get notificationWorker(): NotificationWorker {
  return this.get('notificationWorker', () => {
    const notificationRepo = new PostgresNotificationRepository(this.db);
    const attemptRepo = new PostgresNotificationAttemptRepository(this.db);
    const prefRepo = new PostgresNotificationPreferenceRepository(this.db);
    const dlqRepo = new PostgresNotificationDLQRepository(this.db);

    // Create adapters for supported channels
    const adapters: Record<string, DeliveryAdapter> = {
    email: this.createEmailAdapter(),
    slack: this.createSlackAdapter(),
    };

    return new NotificationWorker(
    notificationRepo,
    attemptRepo,
    adapters,
    prefRepo,
    dlqRepo,
    this.eventBus,
    this.db,
    );
  });
  }

  /**
  * Search Indexing Worker
  */
  get searchIndexingWorker(): SearchIndexingWorker {
  return this.get('searchIndexingWorker', () => {
    const jobRepo = this.indexingJobRepository;
    const documentRepo = new PostgresSearchDocumentRepository(this.db);
    // P0-9 FIX: Provide actual ContentRepository instead of null.
    // Previously passed `null as unknown as ContentRepository` which caused
    // NPE on any contentRepository method call in SearchIndexingWorker.
    const contentRepo = new PostgresContentRepository(this.db);
    return new SearchIndexingWorker(
    jobRepo,
    documentRepo,
    this.eventBus,
    this.db,
    contentRepo,
    );
  });
  }

  /**
  * Indexing Job Repository
  */
  get indexingJobRepository(): import('../../domains/search/application/ports/IndexingJobRepository').IndexingJobRepository {
  return this.get('indexingJobRepository', () => {
    // Import dynamically to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostgresIndexingJobRepository } = require('../../domains/search/infra/persistence/PostgresIndexingJobRepository');
    return new PostgresIndexingJobRepository(this.db);
  });
  }

  /**
  * Create publish adapter based on target type
  */
  private createPublishAdapter(): PublishAdapter {
  const token = process.env['FACEBOOK_PAGE_TOKEN'];
  if (!token) {
    logger.warn('FACEBOOK_PAGE_TOKEN not set, using stub adapter');
    // Return a stub adapter that logs instead of failing
    return {
    publish: async () => {
    logger.info('FacebookAdapter stub: publish called but no token configured');
    return { id: 'stub-id' };
    }
    };
  }

  const adapter = new FacebookAdapter(token);
  if (typeof adapter.publish !== 'function') {
    throw new Error('FacebookAdapter does not implement PublishAdapter interface');
  }
  return adapter as PublishAdapter;
  }

  /**
  * Create email delivery adapter
  */
  private createEmailAdapter(): DeliveryAdapter {
  return {
    send: async (input: import("../../domains/notifications/application/ports/DeliveryAdapter").SendNotificationInput) => {
    // Implementation would use email service
    logger.info('EmailAdapter sending message', { to: input.to, template: input.template });
      return { success: true, attemptedAt: new Date() };
    }
  };
  }

  /**
  * Create Slack delivery adapter
  */
  private createSlackAdapter(): DeliveryAdapter {
  return {
    send: async (input: import("../../domains/notifications/application/ports/DeliveryAdapter").SendNotificationInput) => {
    // Implementation would use Slack webhook
    logger.info('SlackAdapter sending message', { channel: input.to });
      return { success: true, attemptedAt: new Date() };
    }
  };
  }

  /**
  * Create a configured adapter for a specific target
  */
  createAdapter(targetType: string, config: unknown): PublishAdapter {
  if (typeof targetType !== 'string' || !targetType) {
    throw new Error('targetType must be a non-empty string');
  }

  if (!config || typeof config !== 'object') {
    throw new Error('config must be an object');
  }

  switch (targetType) {
    case 'facebook': {
    const fbConfig = config as { pageAccessToken?: string };
    if (!fbConfig.pageAccessToken) {
    throw new Error('Facebook adapter requires pageAccessToken');
    }
    const fbAdapter = new FacebookAdapter(fbConfig.pageAccessToken);
    if (typeof fbAdapter.publish !== 'function') {
    throw new Error('FacebookAdapter does not implement PublishAdapter interface');
    }
    return fbAdapter as PublishAdapter;
    }
    case 'linkedin': {
    const liConfig = config as { accessToken?: string };
    if (!liConfig.accessToken) {
    throw new Error('LinkedIn adapter requires accessToken');
    }
    const liAdapter = new LinkedInAdapter(liConfig.accessToken);
    if (typeof liAdapter.publish !== 'function') {
    throw new Error('LinkedInAdapter does not implement PublishAdapter interface');
    }
    return liAdapter as PublishAdapter;
    }
    default:
    throw new Error(`Unknown adapter type: ${targetType}`);
  }
  }

  /**
  * Get health status of all services
  */
  async getHealth(): Promise<{
  services: Record<string, boolean>;
  details: Record<string, string | undefined>;
  }> {
  const services: Record<string, boolean> = {};
  const details: Record<string, string | undefined> = {};

  // Check database
  try {
    await this.db.query('SELECT 1');
    services["database"] = true;
  } catch (error) {
    services["database"] = false;
    details["database"] = error instanceof Error ? error.message : String(error);
  }

  // Check Redis
  try {
    await this.redis.ping();
    services["redis"] = true;
  } catch (error) {
    services["redis"] = false;
    details["redis"] = error instanceof Error ? error.message : String(error);
  }

  return { services, details };
  }

  /**
  * Dispose of all resources
  */
  async dispose(): Promise<void> {
  if (this.instances.has('redis')) {
    try {
    await this.redis.quit();
    } catch (err) {
    logger.error('Error closing Redis connection', err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Note: dbPool is passed in, so we shouldn't close it here
  // The owner is responsible for closing it

  // Clear all instances
  this.instances.clear();
  }
}

// Global container instance
let globalContainer: Container | null = null;

/**
* Initialize the global container
*/
export function initializeContainer(config: ContainerConfig): Container {
  if (globalContainer) {
  logger.warn('Container already initialized — disposing previous instance');
  void globalContainer.dispose();
  }
  globalContainer = new Container(config);
  return globalContainer;
}

/**
* Get the global container instance
*/
export function getContainer(): Container {
  if (!globalContainer) {
  throw new Error('Container not initialized. Call initializeContainer first.');
  }
  return globalContainer;
}

/**
* Reset the global container (useful for testing)
*/
export function resetContainer(): void {
  if (globalContainer) {
  void globalContainer.dispose();
  globalContainer = null;
  }
}
