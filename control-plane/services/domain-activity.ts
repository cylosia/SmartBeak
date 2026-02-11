import { getLogger } from '@kernel/logger';

﻿import { Pool } from 'pg';


/**
* Domain Activity Service
* Tracks domain publishing and content update activity
*/

const logger = getLogger('domain-activity');

/**
* Domain activity record
*/
export interface DomainActivity {
  domain_id: string;
  last_publish_at: Date | null;
  last_content_update_at: Date | null;
  updated_at: Date;
}

/**
* Domain activity query result
*/
export interface DomainActivityRow {
  domain_id: string;
}

/**
* Maximum allowed days for inactivity query (10 years)
*/
const MAX_INACTIVITY_DAYS = 3650;

/**
* Validate domain ID
*/
function validateDomainId(domainId: unknown): domainId is string {
  return (
  typeof domainId === 'string' &&
  domainId.length > 0 &&
  domainId.length <= 255 &&
  /^[a-zA-Z0-9_-]+$/.test(domainId)
  );
}

/**
* Validate days parameter
*/
function validateDays(days: unknown): days is number {
  return (
  typeof days === 'number' &&
  Number.isFinite(days) &&
  days >= 0 &&
  days <= MAX_INACTIVITY_DAYS &&
  Number.isInteger(days)
  );
}

/**
* Domain activity service for tracking domain operations
*/
export class DomainActivityService {
  constructor(private pool: Pool) {
  if (!pool) {
    throw new Error('Database pool is required');
  }
  }

  /**
  * Mark domain as published
  * @param domainId - Domain identifier
  * @throws Error if database operation fails or invalid domain ID
  */
  async markPublish(domainId: string): Promise<void> {
  try {
    // Validate domain ID
    if (!validateDomainId(domainId)) {
    logger["error"]('Invalid domain ID', new Error('Validation failed'), { domainId });
    throw new Error(
    'Invalid domain ID: must be a non-empty alphanumeric string (max 255 chars)'
    );
    }

    // Sanitize domain ID
    const sanitizedDomainId = domainId.trim();

    await this.pool.query(
    `INSERT INTO domain_activity (domain_id, last_publish_at)
    VALUES ($1, now())
    ON CONFLICT (domain_id)
    DO UPDATE SET last_publish_at=now(), updated_at=now()`,
    [sanitizedDomainId]
    );

    logger.info('Domain publish marked', { domainId: sanitizedDomainId });
  } catch (error) {
    logger["error"](
    'Failed to mark domain publish',
    error instanceof Error ? error : new Error(String(error)),
    { domainId }
    );
    throw error;
  }
  }

  /**
  * Mark domain content as updated
  * @param domainId - Domain identifier
  * @throws Error if database operation fails or invalid domain ID
  */
  async markContentUpdate(domainId: string): Promise<void> {
  try {
    // Validate domain ID
    if (!validateDomainId(domainId)) {
    logger["error"]('Invalid domain ID', new Error('Validation failed'), { domainId });
    throw new Error(
    'Invalid domain ID: must be a non-empty alphanumeric string (max 255 chars)'
    );
    }

    // Sanitize domain ID
    const sanitizedDomainId = domainId.trim();

    await this.pool.query(
    `INSERT INTO domain_activity (domain_id, last_content_update_at)
    VALUES ($1, now())
    ON CONFLICT (domain_id)
    DO UPDATE SET last_content_update_at=now(), updated_at=now()`,
    [sanitizedDomainId]
    );

    logger.info('Domain content update marked', { domainId: sanitizedDomainId });
  } catch (error) {
    logger["error"](
    'Failed to mark domain content update',
    error instanceof Error ? error : new Error(String(error)),
    { domainId }
    );
    throw error;
  }
  }

  /**
  * List inactive domains
  * @param days - Number of days of inactivity
  * @returns Array of domain IDs that have been inactive
  * @throws Error if database operation fails or invalid days parameter
  */
  async listInactive(days: number): Promise<string[]> {
  try {
    // Validate days parameter
    if (!validateDays(days)) {
    logger["error"]('Invalid days parameter', new Error('Validation failed'), {
    maxAllowed: MAX_INACTIVITY_DAYS,
    });
    throw new Error(
    `Invalid days parameter: must be an integer between 0 and ${MAX_INACTIVITY_DAYS}`
    );
    }

    const { rows } = await this.pool.query<DomainActivityRow>(
    `SELECT domain_id
    FROM domain_activity
    WHERE coalesce(last_publish_at, last_content_update_at, now() - interval '100 years')
        < now() - make_interval(days => $1)`,
    [days]
    );

    const domainIds = (rows || []).map((r) => r.domain_id);

    logger.info('Inactive domains listed', {
    count: domainIds.length,
    });

    return domainIds;
  } catch (error) {
    logger["error"](
    'Failed to list inactive domains',
    error instanceof Error ? error : new Error(String(error)),
    { days }
    );
    throw error;
  }
  }

  /**
  * Get activity for a specific domain
  * @param domainId - Domain identifier
  * @returns Domain activity record or null if not found
  */
  async getActivity(domainId: string): Promise<DomainActivity | null> {
  try {
    // Validate domain ID
    if (!validateDomainId(domainId)) {
    logger["error"]('Invalid domain ID', new Error('Validation failed'), { domainId });
    throw new Error(
    'Invalid domain ID: must be a non-empty alphanumeric string (max 255 chars)'
    );
    }

    const sanitizedDomainId = domainId.trim();

    const { rows } = await this.pool.query<DomainActivity>(
    `SELECT domain_id, last_publish_at, last_content_update_at, updated_at
    FROM domain_activity
    WHERE domain_id = $1`,
    [sanitizedDomainId]
    );

    return rows && rows.length > 0 ? (rows[0] as DomainActivity) : null;
  } catch (error) {
    logger["error"](
    'Failed to get domain activity',
    error instanceof Error ? error : new Error(String(error)),
    { domainId }
    );
    throw error;
  }
  }
}
