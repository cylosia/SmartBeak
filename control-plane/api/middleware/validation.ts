/**
 * P2-1 FIX: This file is deprecated. All imports should use @packages/middleware/validation instead.
 * Re-exporting from the canonical module for backwards compatibility.
 * @deprecated Use imports from '@packages/middleware/validation' directly.
 */
export {
  validateBody,
  validateQuery,
  validateParams,
  validateContentType,
  validateUUIDParam,
  sendError,
  createErrorResponse,
  validateSqlColumn,
  buildOrderByClause,
  ValidationConstants,
  CommonSchemas,
} from '@packages/middleware/validation';

export type { ErrorResponse } from '@packages/middleware/validation';

export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const INVALID_PARAMS = 'INVALID_PARAMS';
