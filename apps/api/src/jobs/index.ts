import { registerPublishExecutionJob } from './publishExecutionJob';
import { Pool } from 'pg';
import { registerFeedbackIngestJob } from './feedbackIngestJob';
import { registerExperimentStartJob } from './experimentStartJob';
import { registerContentIdeaJob } from './contentIdeaGenerationJob';
import { JobScheduler } from './JobScheduler';
import { registerDomainExportJob } from './domainExportJob';

/**
 * Jobs Module
 * Exports all job handlers and scheduler configuration
 */
// Then exports
export { JobScheduler } from './JobScheduler';
export { contentIdeaGenerationJob, registerContentIdeaJob } from './contentIdeaGenerationJob';
export { domainExportJob, registerDomainExportJob } from './domainExportJob';
export { publishExecutionJob, registerPublishExecutionJob } from './publishExecutionJob';
export { feedbackIngestJob, registerFeedbackIngestJob } from './feedbackIngestJob';
export { experimentStartJob, registerExperimentStartJob } from './experimentStartJob';
export { assertOrgCapacity } from './jobGuards';
/**
 * Initialize and configure the job scheduler
 * @param redisUrl - Redis connection URL (defaults to env var)
 * @param pool - Database pool for job handlers that need it
 * @returns Configured JobScheduler instance
 */


export type JobDefinitionKey = keyof typeof JOB_DEFINITIONS;

export function initializeJobScheduler(redisUrl?: string, pool?: Pool) {
  const scheduler = new JobScheduler(redisUrl);
  // Register all jobs
  if (pool) {
    registerContentIdeaJob(scheduler, pool);
  }
  registerDomainExportJob(scheduler);
  registerFeedbackIngestJob(scheduler);
  registerPublishExecutionJob(scheduler);
  registerExperimentStartJob(scheduler);
  // Start workers
  // P0-FIX: Prevent worker storm on restart
  if (!scheduler.isRunning()) {
    scheduler.startWorkers(5);
  }
  // Use console for initialization message (structured logger will be used in jobs)
  console.log('[Jobs] Scheduler initialized with all registered jobs');
  return scheduler;
}
/**
 * Predefined job queues
 * MEDIUM FIX M14: Consistent naming conventions
 */
export const QUEUES = {
  HIGH_PRIORITY: 'high_priority',
  AI_TASKS: 'ai-tasks',
  PUBLISHING: 'publishing',
  EXPORTS: 'low_priority_exports',
  NOTIFICATIONS: 'notifications',
  ANALYTICS: 'analytics',
  FEEDBACK: 'feedback',
  EXPERIMENTS: 'experiments',
};
/**
 * Job types with their configurations
 * MEDIUM FIX M4: Proper job priority inheritance
 */
export const JOB_DEFINITIONS = {
  'content-idea-generation': {
    queue: QUEUES.AI_TASKS,
    priority: 'normal',
    maxRetries: 2,
    timeout: 120000,
  },
  'domain-export': {
    queue: QUEUES.EXPORTS,
    priority: 'low',
    maxRetries: 3,
    timeout: 600000,
  },
  'publish-execution': {
    queue: QUEUES.PUBLISHING,
    priority: 'high',
    maxRetries: 3,
    timeout: 300000,
  },
  'feedback-ingest': {
    queue: QUEUES.FEEDBACK,
    priority: 'normal',
    maxRetries: 3,
    timeout: 300000,
  },
  'experiment-start': {
    queue: QUEUES.EXPERIMENTS,
    priority: 'high',
    maxRetries: 2,
    timeout: 60000,
  },
  'keyword-fetch': {
    queue: QUEUES.ANALYTICS,
    priority: 'normal',
    maxRetries: 3,
    timeout: 300000,
  },
  'social-sync': {
    queue: QUEUES.ANALYTICS,
    priority: 'low',
    maxRetries: 2,
    timeout: 180000,
  },
  'image-generation': {
    queue: QUEUES.AI_TASKS,
    priority: 'normal',
    maxRetries: 2,
    timeout: 180000,
  },
};
/**
 * Get job definition by key
 * @param key - Job definition key
 * @returns Job definition or undefined if not found
 */
export function getJobDefinition(key: string) {
  return (JOB_DEFINITIONS as Record<string, typeof JOB_DEFINITIONS[keyof typeof JOB_DEFINITIONS]>)[key];
}
/**
 * Check if job type exists
 * @param key - Job type key to check
 * @returns True if job type is defined
 */
export function isValidJobType(key: string) {
  return key in JOB_DEFINITIONS;
}
