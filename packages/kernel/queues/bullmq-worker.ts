



import { Worker, Job } from 'bullmq';

import { EventBus } from '../event-bus';
import { runWithContext, createRequestContext } from '../request-context';
import { getLogger } from '../logger';

let worker: Worker | null = null;

const logger = getLogger('BullMQWorker');

/**
* Start the BullMQ worker singleton
* Prevents multiple worker instances from being created
* P0-FIX: Added correlation ID propagation for request context tracking
* SECURITY FIX (Finding 10): Added stalled job detection and lock configuration
*/
export function startWorker(eventBus: EventBus): Worker {
  if (worker) {
    return worker;
  }

  worker = new Worker('events', async (job: Job) => {
    // P0-FIX: Create request context from job data for correlation ID propagation
    const requestContext = createRequestContext({
      requestId: job.id || `job-${Date.now()}`,
      traceId: job.data?.traceId || job.id || `trace-${Date.now()}`,
      userId: job.data?.userId,
      orgId: job.data?.orgId,
      path: `job:${job.name}`,
      method: 'WORKER',
    });

    // P0-FIX: Run job processing within request context for proper correlation
    return runWithContext(requestContext, async () => {
      try {
        await eventBus.publish(job["data"]);
      } catch (error) {
        logger.error(`Job ${job?.id} callback error`, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    });
  }, {
    // SECURITY FIX (Finding 10): Stalled job detection and lock management
    // Without these settings, crashed jobs stay "active" forever, blocking concurrency slots
    stalledInterval: 30000,   // Check for stalled jobs every 30 seconds
    lockDuration: 30000,      // Job lock expires after 30 seconds if not renewed
    lockRenewTime: 15000,     // Renew lock every 15 seconds (must be < lockDuration)
    maxStalledCount: 3,       // Allow 3 stall recoveries before marking as failed
    concurrency: 5,           // Process up to 5 jobs concurrently
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err);
  });

  worker.on('error', (err) => {
    logger.error('Worker error', err);
  });

  // SECURITY FIX (Finding 10): Log stalled jobs for monitoring/alerting
  worker.on('stalled', (jobId: string) => {
    logger.error(`Job ${jobId} stalled - possible worker crash or deadlock`);
  });

  return worker;
}

/**
* Stop the BullMQ worker and clean up resources
* Prevents event listener leaks
*/
export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Worker stopped and resources cleaned up');
  }
}

/**
* Check if worker is running
*/
export function isWorkerRunning(): boolean {
  return worker !== null;
}
