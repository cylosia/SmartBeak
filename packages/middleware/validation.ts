import { FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodSchema, ZodError } from 'zod';

import { isValidUUID } from '../security/input-validator';
import { sanitizeErrorMessage } from '../security/logger';
import { ErrorCodes, type ErrorCode, type ErrorResponse } from '@errors';
import { sendError as canonicalSendError } from '@errors/responses';

/**
* Shared middleware for request validation across all routes
*
* P1-HIGH SECURITY FIXES:
* - Issue 7: Missing input validation on query parameters
* - Issue 8: UUID validation inconsistency
* - Issue 10: Missing content-type validation
* - Issue 11: Inconsistent error response format
* - Issue 20: Dynamic SQL without column whitelist
*/

// Re-export ErrorResponse for backward compatibility
export type { ErrorResponse } from '@errors';

/**
* Create standardized error response object (without sending).
*/
export function createErrorResponse(
  error: string,
  code?: string,
  _details?: unknown
): ErrorResponse {
  return {
    error,
    code: code || ErrorCodes.INTERNAL_ERROR,
    requestId: '',
  };
}

/**
* Send error response with proper status code.
* Delegates to canonical sendError from @errors/responses.
*/
export function sendError(
  res: FastifyReply,
  status: number,
  error: string,
  code: string = ErrorCodes.INTERNAL_ERROR,
  details?: unknown
) {
  const sanitizedError = sanitizeErrorMessage(error);
  return canonicalSendError(res, status, code as ErrorCode, sanitizedError, { details });
}

/**
* Validation middleware factory for body validation
*/
export function validateBody<T extends ZodSchema>(
  schema: T,
  handler: (req: FastifyRequest, res: FastifyReply, data: z.infer<T>) => Promise<unknown>
) {
  return async (req: FastifyRequest, res: FastifyReply) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return sendError(
        res,
        400,
        'Validation failed',
        'VALIDATION_ERROR',
        extractZodIssues(result["error"])
      );
    }
    return handler(req, res, result["data"]);
  };
}

/**
* Validation middleware factory for query validation
* SECURITY FIX: Issue 7 - Proper query parameter validation
*/
export function validateQuery<T extends ZodSchema>(
  schema: T,
  handler: (req: FastifyRequest, res: FastifyReply, data: z.infer<T>) => Promise<unknown>
) {
  return async (req: FastifyRequest, res: FastifyReply) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return sendError(
        res,
        400,
        'Query parameter validation failed',
        'VALIDATION_ERROR',
        extractZodIssues(result["error"])
      );
    }
    return handler(req, res, result["data"]);
  };
}

/**
* Validation middleware factory for params validation
* SECURITY FIX: Issue 8 - UUID validation for ID parameters
*/
export function validateParams<T extends ZodSchema>(
  schema: T,
  handler: (req: FastifyRequest, res: FastifyReply, data: z.infer<T>) => Promise<unknown>
) {
  return async (req: FastifyRequest, res: FastifyReply) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return sendError(
        res,
        400,
        'URL parameter validation failed',
        'VALIDATION_ERROR',
        extractZodIssues(result["error"])
      );
    }
    return handler(req, res, result["data"]);
  };
}

/**
 * Extract Zod issues for error response
 */
function extractZodIssues(error: ZodError): Array<{ path: (string | number)[]; message: string }> {
  return error.issues.map(issue => ({
    path: issue.path as (string | number)[],
    message: issue["message"],
  }));
}

/**
 * Validate Content-Type header
 * SECURITY FIX: Issue 10 - Content-type validation
 */
export function validateContentType(
  allowedTypes: string[] = ['application/json']
): (req: FastifyRequest, res: FastifyReply, done: () => void) => void {
  return (req: FastifyRequest, res: FastifyReply, done: () => void): void => {
    const contentType = req.headers['content-type'];
    
    if (!contentType) {
      // Allow if no content-type specified (e.g., GET requests)
      return done();
    }
    
    const baseType = contentType.split(';')[0]?.trim().toLowerCase() || '';
    
    if (!allowedTypes.includes(baseType)) {
      void res.status(415).send(createErrorResponse(
        `Unsupported Content-Type: ${baseType}. Allowed: ${allowedTypes.join(', ')}`,
        'UNSUPPORTED_MEDIA_TYPE'
      ));
      return;
    }
    
    done();
  };
}

/**
 * Validate UUID parameter
 * SECURITY FIX: Issue 8 - UUID validation consistency
 */
export function validateUUIDParam(
  paramName: string = 'id'
): (req: FastifyRequest, res: FastifyReply, done: () => void) => void {
  return (req: FastifyRequest, res: FastifyReply, done: () => void): void => {
    const value = (req.params as Record<string, string>)[paramName];
    
    if (!value) {
      void res.status(400).send(createErrorResponse(
        `Missing required parameter: ${paramName}`,
        'MISSING_PARAMETER'
      ));
      return;
    }

    if (!isValidUUID(value)) {
      void res.status(400).send(createErrorResponse(
        `Invalid UUID format for parameter: ${paramName}`,
        'INVALID_UUID'
      ));
      return;
    }
    
    done();
  };
}

export const ValidationConstants = {
  UUID_LENGTH: 36,
  MAX_TITLE_LENGTH: 500,
  MAX_BODY_LENGTH: 50000,
  MAX_DESCRIPTION_LENGTH: 500,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

// Common schemas
export const CommonSchemas = {
  // SECURITY FIX: Issue 8 - Consistent UUID validation
  uuid: z.string().refine(val => isValidUUID(val), {
    message: 'Invalid UUID format',
  }),
  
  idParam: z.object({
    id: z.string().refine(val => isValidUUID(val), {
      message: 'Invalid UUID format',
    }),
  }),
  
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(ValidationConstants.MAX_PAGE_SIZE).default(ValidationConstants.DEFAULT_PAGE_SIZE),
  }),
};

/**
 * Whitelist for SQL column names
 * SECURITY FIX: Issue 20 - Column whitelist for dynamic SQL
 */
const SQL_COLUMN_WHITELIST = new Set([
  'id', 'name', 'email', 'created_at', 'updated_at', 'deleted_at',
  'status', 'plan', 'plan_status', 'org_id', 'user_id', 'domain_id',
  'title', 'body', 'content', 'description', 'metadata',
  'stripe_customer_id', 'stripe_subscription_id',
]);

/**
 * Validate SQL column name against whitelist
 * SECURITY FIX: Issue 20 - Prevent SQL injection via column names
 */
export function validateSqlColumn(column: string): string {
  const normalized = column.toLowerCase().trim();
  
  if (!SQL_COLUMN_WHITELIST.has(normalized)) {
    throw new Error(`Invalid column name: ${column}`);
  }
  
  // Additional validation: only allow alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
    throw new Error(`Invalid column name format: ${column}`);
  }
  
  return normalized;
}

/**
 * Build safe ORDER BY clause
 * SECURITY FIX: Issue 20 - Safe dynamic SQL construction
 */
export function buildOrderByClause(
  sortBy: string,
  sortOrder: 'asc' | 'desc' = 'desc'
): { column: string; order: string } {
  const validatedColumn = validateSqlColumn(sortBy);
  const validatedOrder = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  
  return { column: validatedColumn, order: validatedOrder };
}

// Default export
export default {
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
};
