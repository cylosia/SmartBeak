/**
* Enqueue a job to a region-specific queue
* @param region - Target region (e.g., 'us-east-1', 'eu-west-1')
* @param jobId - Unique job identifier
*/
export function enqueueToRegion(region: string, jobId: string): void {
  if (!region || typeof region !== 'string') {
  throw new Error('Invalid region: must be a non-empty string');
  }
  if (!jobId || typeof jobId !== 'string') {
  throw new Error('Invalid jobId: must be a non-empty string');
  }

  const timestamp = new Date().toISOString();
  process.stdout.write(`[${timestamp}] [INFO] [queue:${region}] enqueue job ${jobId}\n`);
}
