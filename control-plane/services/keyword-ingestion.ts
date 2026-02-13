import { getLogger } from '@kernel/logger';
import pLimit from 'p-limit';
import { AhrefsAdapter } from '../adapters/keywords/ahrefs';
import { GscAdapter } from '../adapters/keywords/gsc';
import { PaaAdapter } from '../adapters/keywords/paa';

const logger = getLogger('keyword-ingestion');

// Adapter factory functions that create instances on demand
const ADAPTERS = [
  { source: 'ahrefs' as const, create: () => new AhrefsAdapter() },
  { source: 'gsc' as const, create: () => new GscAdapter() },
  { source: 'paa' as const, create: () => new PaaAdapter() }
];

// P0-FIX: Bounded concurrency for batch insertions
const MAX_CONCURRENT_INSERTS = 10;

export interface KeywordSuggestion {
  keyword: string;
  metrics?: Record<string, unknown>;
}

export interface KeywordAdapter {
  source: string;
  fetch: (domainName: string) => Promise<KeywordSuggestion[]>;
}

export interface IngestionJob {
  id: string;
  domain_id: string;
  source: string;
  status: string;
  completed_at?: Date;
  notes?: string;
}

export interface Database {
  keyword_ingestion_jobs: {
  insert: (data: Partial<IngestionJob>) => Promise<IngestionJob>;
  update: (id: string, data: Partial<IngestionJob>) => Promise<void>;
  };
  keyword_suggestions: {
  insert: (data: {
    domain_id: string;
    keyword: string;
    source: string;
    metrics?: Record<string, unknown>;
    ingestion_job_id: string;
  }) => Promise<void>;
  };
}

export interface IngestionInput {
  domain_id: string;
  domain_name: string;
  source?: string;
}

/**
* Run keyword ingestion
* P2-04: Adapters are processed concurrently via Promise.allSettled
*/
export async function runKeywordIngestion(
  db: Database,
  input: IngestionInput
): Promise<void> {
  // Validate inputs
  if (!input.domain_id || !input.domain_name) {
  throw new Error('domain_id and domain_name are required');
  }

  const adapters = input.source
  ? ADAPTERS.filter(a => a.source === input.source)
  : ADAPTERS;

  // P2-04: Process adapters concurrently instead of sequentially
  const results = await Promise.allSettled(
  adapters.map(adapterFactory => processAdapter(db, input, adapterFactory))
  );

  // Log any failures
  for (let i = 0; i < results.length; i++) {
  const result = results[i];
  if (result && result.status === 'rejected') {
    logger.error(`Adapter ${adapters[i]?.source ?? 'unknown'} failed unexpectedly: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  }
  }
}

async function processAdapter(
  db: Database,
  input: IngestionInput,
  adapterFactory: typeof ADAPTERS[number]
): Promise<void> {
  const adapter = adapterFactory.create();
  const job = await db.keyword_ingestion_jobs.insert({
  domain_id: input.domain_id,
  source: adapter.source,
  status: 'running'
  });

  try {
  const suggestions = await adapter.fetch(input.domain_name);

  await batchInsertSuggestions(
    db,
    suggestions,
    input.domain_id,
    adapterFactory.source,
    job.id
  );

  await db.keyword_ingestion_jobs.update(job.id, {
    status: 'completed',
    completed_at: new Date()
  });
  } catch (e) {
  // P2-08: Preserve stack trace in error notes for debugging
  const errorDetail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  await db.keyword_ingestion_jobs.update(job.id, {
    status: 'failed',
    completed_at: new Date(),
    notes: errorDetail
  });
  const errorMessage = e instanceof Error ? e.message : String(e);
  logger.error(`Adapter ${adapterFactory.source} failed: ${errorMessage}`);
  }
}

/**
* P0-FIX: Batch insert keyword suggestions with bounded concurrency
* Prevents connection pool exhaustion with large suggestion sets
*/
async function batchInsertSuggestions(
  db: Database,
  suggestions: KeywordSuggestion[],
  domainId: string,
  source: string,
  jobId: string,
  batchSize = 100
): Promise<void> {
  // P0-FIX: Use p-limit for bounded concurrency
  const limit = pLimit(MAX_CONCURRENT_INSERTS);

  for (let i = 0; i < suggestions.length; i += batchSize) {
  const batch = suggestions.slice(i, i + batchSize);
  await Promise.all(
    batch.map(s =>
    limit(() =>
        db.keyword_suggestions.insert({
        domain_id: domainId,
        keyword: s.keyword,
        source: source,
        ...(s.metrics !== undefined ? { metrics: s.metrics } : {}),
        ingestion_job_id: jobId
        })
    )
    )
  );
  }
}
