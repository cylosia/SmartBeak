/**
 * Pagination Configuration
 * 
 * Pagination settings for list endpoints.
 */

import { parseIntEnv } from './env';

export const paginationConfig = {
  /** Default page size */
  defaultLimit: parseIntEnv('PAGINATION_DEFAULT_LIMIT', 25),

  /** Maximum allowed page size */
  maxLimit: parseIntEnv('PAGINATION_MAX_LIMIT', 100),

  /** Maximum page size for admin endpoints */
  adminMaxLimit: parseIntEnv('PAGINATION_ADMIN_MAX_LIMIT', 1000),

  /** Default admin page size */
  adminDefaultLimit: parseIntEnv('PAGINATION_ADMIN_DEFAULT_LIMIT', 50),
} as const;
