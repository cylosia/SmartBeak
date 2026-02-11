

import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

const logger = getLogger('planning:overview');

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Planning overview data structure
*/
export interface PlanningOverview {
  /** Number of active authors */
  authorsActive: number;
  /** Number of active customers */
  customersActive: number;
  /** Number of keywords */
  keywords: number;
  /** Number of content ideas */
  ideas: number;
  /** Number of published items */
  published: number;
}

/**
* Result type for overview operation
*/
export interface OverviewResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Planning overview data */
  overview?: PlanningOverview;
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// Planning Overview Service
// ============================================================================

/**
* Service for providing planning overview data.
*
* This service aggregates statistics for the planning dashboard,
* including active authors, customers, keywords, ideas, and published content.
*/
export class PlanningOverviewService {
  /** Query timeout in milliseconds */
  private static readonly QUERY_TIMEOUT = 5000;

  /**
  * Create a new PlanningOverviewService
  * @param pool - Database connection pool
  */
  constructor(private readonly pool: Pool) {}

  /**
  * Get planning overview for a domain
  *
  * @param domainId - Domain ID to get overview for
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await service.overview('domain-123');
  * if (result.success) {
  *   // Overview data retrieved successfully
  * }
  * ```
  */
  async overview(domainId: string): Promise<OverviewResult> {
  // Validate input
  const validationError = this.validateDomainId(domainId);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    // Execute queries in parallel
    const [authorsResult, customersResult, keywordsResult, ideasResult, publishedResult] = await Promise.all([
    this.getActiveAuthorsCount(domainId),
    this.getActiveCustomersCount(domainId),
    this.getKeywordsCount(domainId),
    this.getIdeasCount(domainId),
    this.getPublishedCount(domainId)
    ]);

    return {
    success: true,
    overview: {
    authorsActive: authorsResult,
    customersActive: customersResult,
    keywords: keywordsResult,
    ideas: ideasResult,
    published: publishedResult
    }
    };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to get planning overview'
    };
  }
  }

  // ============================================================================
  // Count Queries
  // ============================================================================

  /**
  * Get active authors count
  * @param domainId - Domain ID
  * @returns Count of active authors
  */
  private async getActiveAuthorsCount(domainId: string): Promise<number> {
  try {
    const { rows } = await this.pool.query(
    `SELECT count(*) as count
    FROM authors
    WHERE domain_id = $1 AND active = true`,
    [domainId]
    );
    return Number(rows[0]?.count || 0);
  } catch (error) {
    logger.error('Failed to get active authors count', error as Error, { domainId });
    return 0;
  }
  }

  /**
  * Get active customers count
  * @param domainId - Domain ID
  * @returns Count of active customers
  */
  private async getActiveCustomersCount(domainId: string): Promise<number> {
  try {
    const { rows } = await this.pool.query(
    `SELECT count(*) as count
    FROM customer_profiles
    WHERE domain_id = $1 AND active = true`,
    [domainId]
    );
    return Number(rows[0]?.count || 0);
  } catch (error) {
    logger.error('Failed to get active customers count', error as Error, { domainId });
    return 0;
  }
  }

  /**
  * Get keywords count
  * @param domainId - Domain ID
  * @returns Count of keywords
  */
  private async getKeywordsCount(domainId: string): Promise<number> {
  try {
    const { rows } = await this.pool.query(
    'SELECT count(*) as count FROM keywords WHERE domain_id = $1',
    [domainId]
    );
    return Number(rows[0]?.count || 0);
  } catch (error) {
    logger.warn('Keywords table query failed, returning 0', { domainId, error: (error as Error).message });
    return 0;
  }
  }

  /**
  * Get ideas count
  * @param domainId - Domain ID
  * @returns Count of content ideas
  */
  private async getIdeasCount(domainId: string): Promise<number> {
  try {
    const { rows } = await this.pool.query(
    'SELECT count(*) as count FROM content_ideas WHERE domain_id = $1',
    [domainId]
    );
    return Number(rows[0]?.count || 0);
  } catch (error) {
    logger.warn('Content ideas table query failed, returning 0', { domainId, error: (error as Error).message });
    return 0;
  }
  }

  /**
  * Get published content count
  * @param domainId - Domain ID
  * @returns Count of published content
  */
  private async getPublishedCount(domainId: string): Promise<number> {
  try {
    const { rows } = await this.pool.query(
    `SELECT count(*) as count
    FROM content_items
    WHERE domain_id = $1 AND status = 'published'`,
    [domainId]
    );
    return Number(rows[0]?.count || 0);
  } catch (error) {
    logger.warn('Content items table query failed, returning 0', { domainId, error: (error as Error).message });
    return 0;
  }
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
  * Validates domain ID
  * @param domainId - Domain ID to validate
  * @returns Error message if invalid, undefined if valid
  */
  private validateDomainId(domainId: string): string | undefined {
  if (!domainId || typeof domainId !== 'string') {
    return 'Domain ID is required and must be a string';
  }
  if (domainId.length < 1 || domainId.length > 255) {
    return 'Domain ID must be between 1 and 255 characters';
  }
  return undefined;
  }
}
