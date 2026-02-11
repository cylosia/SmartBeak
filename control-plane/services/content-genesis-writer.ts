import { getLogger } from '@kernel/logger';

/**
* Content Genesis Writer Service
* Records content creation events
*/

const logger = getLogger('content-genesis-writer');

/**
* Database interface for content genesis operations
*/
export interface ContentGenesisDb {
  content_genesis: {
  insert(input: ContentGenesisInput): Promise<ContentGenesisRecord>;
  };
}

/**
* Input for recording content genesis
*/
export interface ContentGenesisInput {
  domain_id: string;
  content_id?: string;
  content_type: 'article' | 'page' | 'post' | string;
  title?: string;
  source?: 'ai' | 'manual' | 'import' | string;
  metadata?: Record<string, unknown>;
  created_by?: string;
  created_at?: Date;
}

/**
* Content genesis record
*/
export interface ContentGenesisRecord {
  id: string;
  domain_id: string;
  content_id: string | null;
  content_type: string;
  title: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: Date;
}

/**
* Validate content genesis input
*/
function validateContentGenesisInput(input: unknown): input is ContentGenesisInput {
  if (!input || typeof input !== 'object') {
  return false;
  }

  const data = input as Record<string, unknown>;

  // Required fields
  if (typeof data["domain_id"] !== 'string' || data["domain_id"].length === 0) {
  return false;
  }

  if (typeof data["content_type"] !== 'string' || data["content_type"].length === 0) {
  return false;
  }

  // Optional field validations
  if (data["content_id"] !== undefined && typeof data["content_id"] !== 'string') {
  return false;
  }

  if (data["title"] !== undefined && typeof data["title"] !== 'string') {
  return false;
  }

  if (data["source"] !== undefined && typeof data["source"] !== 'string') {
  return false;
  }

  if (data["created_by"] !== undefined && typeof data["created_by"] !== 'string') {
  return false;
  }

  return true;
}

/**
* Record a content genesis event
* @param db - Database instance
* @param input - Content genesis input
* @returns The created content genesis record
* @throws Error if input validation fails or database operation fails
*/
export async function recordContentGenesis(
  db: ContentGenesisDb,
  input: ContentGenesisInput
): Promise<ContentGenesisRecord> {
  try {
  // Validate input
  if (!validateContentGenesisInput(input)) {
    logger["error"]('Invalid content genesis input', new Error('Validation failed'), { input: input as unknown as Record<string, unknown> });
    throw new Error('Invalid content genesis input: domain_id and content_type are required');
  }

  // Validate database interface
  if (!db || typeof db.content_genesis?.insert !== 'function') {
    logger["error"]('Invalid database interface provided', new Error('Database interface validation failed'));
    throw new Error('Invalid database interface');
  }

  // Sanitize input
  const sanitizedInput: ContentGenesisInput = {
    domain_id: input["domain_id"].trim(),
    content_type: input["content_type"].trim(),
    ...(input["content_id"] && { content_id: input["content_id"].trim() }),
    ...(input["title"] && { title: input["title"].trim() }),
    ...(input["source"] && { source: input["source"].trim() }),
    ...(input.metadata && { metadata: input.metadata }),
    ...(input["created_by"] && { created_by: input["created_by"].trim() }),
    ...(input.created_at && { created_at: input.created_at }),
  };

  const result = await db.content_genesis.insert(sanitizedInput);

  logger.info('Content genesis recorded successfully', {
    domainId: sanitizedInput["domain_id"],
    contentType: sanitizedInput["content_type"],
  });

  return result;
  } catch (error) {
  logger["error"](
    'Failed to record content genesis',
    error instanceof Error ? error : new Error(String(error)),
    { input: input as unknown as Record<string, unknown> }
  );
  throw error;
  }
}
