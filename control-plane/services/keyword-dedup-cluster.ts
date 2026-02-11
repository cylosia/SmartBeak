import pLimit from 'p-limit';

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
  keyword_cluster_members: {
  insert: (data: { cluster_id: string; keyword_id: string }) => Promise<void>;
  };
}

export interface PoolClient {
  query: (sql: string) => Promise<void>;
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

/**
* Deduplicate and cluster keywords
*/
export async function dedupAndCluster(db: Database, domainId: string, pool?: Pool): Promise<void> {
  // Validate inputs
  if (!domainId || typeof domainId !== 'string') {
  throw new Error('Valid domainId is required');
  }

  const result = await db.query('SELECT id, keyword FROM keywords WHERE domain_id = $1', [domainId]);
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
type PoolClientWithParams = PoolClient & {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<{ id: string }> }>;
};

async function createClusterWithMembers(
  db: Database,
  pool: Pool | undefined,
  domainId: string,
  clusterGroup: ClusterGroup
): Promise<void> {
  if (!pool) {
  // Fallback to non-transactional if pool not provided
  const cluster = await db.keyword_clusters.insert({
    domain_id: domainId,
    label: clusterGroup.label,
    method: 'lexical'
  });
  await batchInsertClusterMembers(db, cluster["id"], clusterGroup.members);
  return;
  }

  const client = await pool.connect() as PoolClientWithParams;
  try {
  await client.query('BEGIN');
  await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

  const clusterResult = await client.query(
    'INSERT INTO keyword_clusters (domain_id, label, method) VALUES ($1, $2, $3) RETURNING id',
    [domainId, clusterGroup.label, 'lexical']
  );
  const clusterId = clusterResult.rows[0]!["id"];

  const batchSize = 100;
  for (let i = 0; i < clusterGroup.members.length; i += batchSize) {
    const batch = clusterGroup.members.slice(i, i + batchSize);

    const limit = pLimit(5);
    await Promise.all(
    batch.map(m => limit(() => client.query(
    'INSERT INTO keyword_cluster_members (cluster_id, keyword_id) VALUES ($1, $2)',
    [clusterId, m["id"]]
    )))
    );
  }

  await client.query('COMMIT');
  } catch (error) {

  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    // Rollback error - already in error handling, cannot recover
  }
  throw error;
  } finally {
  client.release();
  }
}

/**
* Batch insert cluster members
*/
async function batchInsertClusterMembers(
  db: Database,
  clusterId: string,
  members: Keyword[],
  batchSize = 100
): Promise<void> {
  const limit = pLimit(5);
  for (let i = 0; i < members.length; i += batchSize) {
  const batch = members.slice(i, i + batchSize);
  await Promise.all(
    batch.map(m => limit(() => db.keyword_cluster_members.insert({
    cluster_id: clusterId,
    keyword_id: m["id"]
    })))
  );
  }
}
