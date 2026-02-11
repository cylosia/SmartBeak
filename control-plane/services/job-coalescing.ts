/**
* Coalescing rules:
* - For publishing: last job per (domain, content, target) wins
* - For search: last index job per (index, content) wins
*/

/**
* Coalesce jobs by key, keeping only the last job for each unique key
* @param jobs - Array of jobs with a key property
* @returns Array of coalesced jobs
*/
export function coalesceJobs<T extends { key: string }>(jobs: T[]): T[] {
  const map = new Map<string, T>();
  for (const job of jobs) {
  map.set(job.key, job);
  }
  return [...map.values()];
}
