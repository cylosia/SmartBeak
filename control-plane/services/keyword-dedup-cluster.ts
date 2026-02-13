import { getLogger } from '@kernel/logger';

const logger = getLogger('keyword-dedup-cluster');

/**
* Deterministic lexical deduplication & clustering.
* - Lowercase
* - Trim punctuation
* - Group by normalized stem
* Advisory only.
*/


export interface Keyword {
  id: string;
  keyword: string;
}

export interface Database {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Keyword[] }>;
  keyword_clusters: {
  insert: (data: { domain_id: string; label: string; method: string }) => Promise<{ id: string }>;
  };
  // P0-03: Fixed table name to match migration (cluster_keywords, not keyword_cluster_members)
  cluster_keywords: {
  insert: (data: { cluster_id: string; keyword_id: string }) => Promise<void>;
  };
}

export interface PoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<{ id: string }> }>;
  release: () => void;
}

export interface Pool {
  connect: () => Promise<PoolClient>;
}

export interface ClusterGroup {
  label: string;
  members: Keyword[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// P1-05: Maximum keywords to load in a single batch to prevent OOM
const MAX_KEYWORDS_PER_QUERY = 50000;

/**
* Deduplicate and cluster keywords
* P2-09: pool is now required for transactional safety
*/
export async function dedupAndCluster(db: Database, domainId: string, pool: Pool): Promise<void> {
  // Validate inputs
  if (!domainId || typeof domainId !== 'string') {
  throw new Error('Valid domainId is required');
  }

  // P1-05: Add LIMIT to prevent unbounded memory usage on large domains
  const result = await db.query(
  'SELECT id, keyword FROM keywords WHERE domain_id = $1 LIMIT $2',
  [domainId, MAX_KEYWORDS_PER_QUERY]
  );
  const groups: Record<string, Keyword[]> = {};

  for (const row of result.rows) {
  const key = normalize(row.keyword);
  groups[key] = groups[key] || [];
  groups[key].push(row);
  }

  const clustersToCreate: ClusterGroup[] = [];

  for (const [label, members] of Object.entries(groups)) {
  if (members.length < 2) continue;
  clustersToCreate.push({ label, members });
  }

  // Process clusters with transaction wrapper
  for (const clusterGroup of clustersToCreate) {
  await createClusterWithMembers(db, pool, domainId, clusterGroup);
  }
}

/**
* Create cluster with members in a transaction
*/
async function createClusterWithMembers(
  db: Database,
  pool: Pool,
  domainId: string,
  clusterGroup: ClusterGroup
): Promise<void> {
  const client = await pool.connect();
  try {
  await client.query('BEGIN');
  // P1-06: SET LOCAL does not support parameterized values — use literal
  await client.query("SET LOCAL statement_timeout = '30000'");

  // P0-04: 'method' column must exist in keyword_clusters — see migration fix
  const clusterResult = await client.query(
    'INSERT INTO keyword_clusters (domain_id, label, method) VALUES ($1, $2, $3) RETURNING id',
    [domainId, clusterGroup.label, 'lexical']
  );
  const clusterId = clusterResult.rows[0]!.id;

  // P2-05: Use multi-row INSERT instead of pLimit(5) on a single connection
  // PostgreSQL serializes queries on a single connection anyway
  const batchSize = 500;
  for (let i = 0; i < clusterGroup.members.length; i += batchSize) {
    const batch = clusterGroup.members.slice(i, i + batchSize);
    if (batch.length === 0) continue;

    // Build multi-row VALUES clause
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch.length; j++) {
    const offset = j * 2;
    placeholders.push(`($${offset + 1}, $${offset + 2})`);
    values.push(clusterId, batch[j]!.id);
    }

    // P0-03: Fixed table name to cluster_keywords (matches migration)
    await client.query(
    `INSERT INTO cluster_keywords (cluster_id, keyword_id) VALUES ${placeholders.join(', ')}`,
    values
    );
  }

  await client.query('COMMIT');
  } catch (error) {

  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    // ADVERSARIAL-04: Log rollback failure instead of silently swallowing
    logger.error('[keyword-dedup-cluster] ROLLBACK failed during error handling:', rollbackError as Error);
  }
  throw error;
  } finally {
  client.release();
  }
}
