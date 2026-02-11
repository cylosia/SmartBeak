


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
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err);
  });

  worker.on('error', (err) => {
    logger.error('Worker error', err);
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
