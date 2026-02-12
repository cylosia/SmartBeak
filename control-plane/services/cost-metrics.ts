import { getLogger } from '@kernel/logger';

import { Pool } from 'pg';


/**
* Cost Metrics Service
* Tracks and calculates infrastructure costs per domain
*/

const logger = getLogger('cost-metrics');

/**
* Cost metrics per domain result
*/
export interface CostPerDomainResult {
  domains: number;
  note: string;
  estimatedCostPerDomain?: number;
}

/**
* Domain count query result
*/
export interface DomainCountRow {
  domains: string;
}

/**
* Cost metrics service for infrastructure cost tracking
*/
export class CostMetricsService {
  constructor(private pool: Pool) {
  if (!pool) {
    throw new Error('Database pool is required');
  }
  }

  /**
  * Calculate cost per domain
  * @returns Cost metrics including domain count and estimated costs
  * @throws Error if database query fails
  */
  async costPerDomain(): Promise<CostPerDomainResult> {
  try {
    // Validate pool connection
    if (!this.pool.query) {
    throw new Error('Invalid database pool: query method not available');
    }

    const { rows } = await this.pool.query<DomainCountRow>(
    `SELECT count(*) AS domains FROM domain_registry`
    );

    if (!rows || rows.length === 0) {
    logger.warn('No results returned from domain count query');
    return {
    domains: 0,
    note: 'Attach infra costs here',
    };
    }

    const domainCount = Number(rows[0]!['domains']);

    if (!Number.isFinite(domainCount) || domainCount < 0) {
    logger["error"]('Invalid domain count returned from database', new Error('Invalid count'), {
    rawValue: rows[0]!['domains'],
    });
    throw new Error('Invalid domain count returned from database');
    }

    const result: CostPerDomainResult = {
    domains: domainCount,
    note: 'Attach infra costs here',
    };

    logger.info('Cost per domain calculated', {
    domains: domainCount,
    });

    return result;
  } catch (error) {
    logger["error"](
    'Failed to calculate cost per domain',
    error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
  }

  /**
  * Get comprehensive cost breakdown
  * @returns Detailed cost breakdown by category
  */
  async getCostBreakdown(): Promise<{
  compute: number;
  storage: number;
  bandwidth: number;
  total: number;
  }> {
  try {
    // Placeholder for future implementation
    // This would query actual cost tables or external billing APIs
    return {
    compute: 0,
    storage: 0,
    bandwidth: 0,
    total: 0,
    };
  } catch (error) {
    logger["error"](
    'Failed to get cost breakdown',
    error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
  }
}
