


import { Pool } from 'pg';
import { validatePublishTargetConfig } from '@domain/shared/infra/validation/DatabaseSchemas';

import { getLogger } from '@kernel/logger';
import { ValidationError } from '@errors';

import { PublishTarget } from '../../domain/entities/PublishTarget';
import type { PublishTargetType } from '../../domain/entities/PublishTarget';
import { PublishTargetRepository } from '../../application/ports/PublishTargetRepository';

const logger = getLogger('publishing:target:repository');

const VALID_TARGET_TYPES: readonly PublishTargetType[] = ['wordpress', 'webhook', 'api', 'social'];

function validateTargetType(type: string): PublishTargetType {
  if (!VALID_TARGET_TYPES.includes(type as PublishTargetType)) {
    throw new ValidationError(`Invalid publish target type: ${type}`);
  }
  return type as PublishTargetType;
}

/**
* Repository implementation for PublishTarget using PostgreSQL
* */
export class PostgresPublishTargetRepository implements PublishTargetRepository {
  constructor(private pool: Pool) {}

  /**
  * List enabled publish targets for a domain
  */
  async listEnabled(domainId: string, limit: number = 100): Promise<PublishTarget[]> {
  // Validate input
  if (!domainId || typeof domainId !== 'string') {
    throw new Error('domainId must be a non-empty string');
  }
  // Clamp limit to prevent unbounded queries
  const MAX_LIMIT = 1000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  try {
    const { rows } = await this.pool.query(
    `SELECT id, domain_id, type, config, enabled
    FROM publish_targets
    WHERE domain_id = $1 AND enabled = true
    LIMIT $2`,
    [domainId, safeLimit]
    );

    return rows.map(r => {
    // Validate config when reading from database
    try {
    validatePublishTargetConfig(r.config);
    } catch (error: unknown) {
    logger.warn('Invalid publish target config in database', {
    id: r.id,
    error: error instanceof Error ? error.message : String(error)
    });
    }

    // Create a deep copy of config to prevent external mutation
    const configCopy = JSON.parse(JSON.stringify(r.config ?? {}));
    return PublishTarget.reconstitute(r.id, r.domain_id, validateTargetType(r.type), configCopy, r.enabled);
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list enabled publish targets', err, { domainId });
    throw error;
  }
  }

  /**
  * Save a publish target
  */
  async save(target: PublishTarget): Promise<void> {
  // Validate input
  if (!target || typeof target.id !== 'string') {
    throw new Error('target must have a valid id');
  }
  try {
    // Validate JSONB config before saving
    validatePublishTargetConfig(target.config);

    await this.pool.query(
    `INSERT INTO publish_targets (id, domain_id, type, config, enabled)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id)
    DO UPDATE SET
    type = $3,
    config = $4,
    enabled = $5`,
    [target.id, target.domainId, target.type, JSON.stringify(target.config), target.enabled]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to save publish target', err, {
    id: target.id,
    domainId: target.domainId
    });
    throw error;
  }
  }

  /**
  * Get publish target by ID
  */
  async getById(id: string): Promise<PublishTarget | null> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    const { rows } = await this.pool.query(
    `SELECT id, domain_id, type, config, enabled
    FROM publish_targets
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) return null;

    const r = rows[0];

    // Validate config when reading from database
    try {
    validatePublishTargetConfig(r.config);
    } catch (error: unknown) {
    logger.warn('Invalid publish target config in database', {
    id: r.id,
    error: error instanceof Error ? error.message : String(error)
    });
    }

    // Create a deep copy of config to prevent external mutation
    const configCopy = JSON.parse(JSON.stringify(r.config ?? {}));
    return PublishTarget.reconstitute(r.id, r.domain_id, validateTargetType(r.type), configCopy, r.enabled);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get publish target by ID', err, { id });
    throw error;
  }
  }

  /**
  * Delete a publish target
  */
  async delete(id: string): Promise<void> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    await this.pool.query(
    'DELETE FROM publish_targets WHERE id = $1',
    [id]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete publish target', err, { id });
    throw error;
  }
  }
}
