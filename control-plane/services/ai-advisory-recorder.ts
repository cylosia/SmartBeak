

import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

const logger = getLogger('ai-advisory-recorder');

export interface AiAdvisoryInput {
  tenant_id: string;
  domain_id?: string;
  advisory_type: string;
  provider: string;
  model_identifier: string;
  prompt_template_version: string;
  parameters: Record<string, unknown>;
  output: string;
  confidence_notes?: string;
  buyer_visible?: boolean;
}

export interface AiAdvisoryArtifact {
  id: string;
  tenant_id: string;
  domain_id: string | null;
  advisory_type: string;
  provider: string;
  model_identifier: string;
  prompt_template_version: string;
  parameters: Record<string, unknown>;
  output: string;
  confidence_notes: string | null;
  buyer_visible: boolean;
  advisory_label: string;
  created_at: Date;
  [key: string]: unknown;
}

/**
* Records an AI advisory artifact to the database.
*
* @param pool - PostgreSQL connection pool
* @param input - The advisory data to record
* @returns The created artifact record
* @throws Error if validation fails or database operation fails
*/
export async function recordAiAdvisory(
  pool: Pool,
  input: AiAdvisoryInput
): Promise<AiAdvisoryArtifact> {
  // Input validation
  if (!pool) {
  throw new Error('Database pool is required');
  }
  if (!input || typeof input !== 'object') {
  throw new Error('Input is required');
  }
  if (!input.tenant_id || typeof input.tenant_id !== 'string') {
  throw new Error('Valid tenant_id (string) is required');
  }
  if (input.domain_id !== undefined && typeof input.domain_id !== 'string') {
  throw new Error('domain_id must be a string if provided');
  }
  if (!input.advisory_type || typeof input.advisory_type !== 'string') {
  throw new Error('Valid advisory_type (string) is required');
  }
  if (!input.provider || typeof input.provider !== 'string') {
  throw new Error('Valid provider (string) is required');
  }
  if (!input.model_identifier || typeof input.model_identifier !== 'string') {
  throw new Error('Valid model_identifier (string) is required');
  }
  if (!input.prompt_template_version || typeof input.prompt_template_version !== 'string') {
  throw new Error('Valid prompt_template_version (string) is required');
  }
  if (!input.parameters || typeof input.parameters !== 'object') {
  throw new Error('Valid parameters (object) is required');
  }
  if (!input.output || typeof input.output !== 'string') {
  throw new Error('Valid output (string) is required');
  }
  if (input.confidence_notes !== undefined && typeof input.confidence_notes !== 'string') {
  throw new Error('confidence_notes must be a string if provided');
  }
  if (input.buyer_visible !== undefined && typeof input.buyer_visible !== 'boolean') {
  throw new Error('buyer_visible must be a boolean if provided');
  }

  try {
  const result = await pool.query<AiAdvisoryArtifact>(
    `INSERT INTO ai_advisory_artifacts
    (tenant_id, domain_id, advisory_type, provider, model_identifier,
    prompt_template_version, parameters, output, confidence_notes, buyer_visible, advisory_label)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
    input.tenant_id,
    input.domain_id ?? null,
    input.advisory_type,
    input.provider,
    input.model_identifier,
    input.prompt_template_version,
    JSON.stringify(input.parameters),
    input.output,
    input.confidence_notes ?? null,
    input.buyer_visible ?? true,
    'advisory_only'
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to insert advisory artifact');
  }

  logger.info('Recorded advisory artifact', { artifactId: result.rows[0]!["id"] });

  return result.rows[0] as AiAdvisoryArtifact;
  } catch (error) {
  logger.error('Error recording advisory', new Error(`error: ${error instanceof Error ? error.message : String(error)}`));
  throw new Error(`Failed to record AI advisory: ${error instanceof Error ? error.message : String(error)}`);
  }
}
