import { z, ZodSchema } from 'zod';
import { FastifyRequest, FastifyReply } from 'fastify';

/**
* Shared middleware for request validation across all routes
*/

export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const INVALID_PARAMS = 'INVALID_PARAMS';

/**
* Extract Zod issues from validation error
*/
function extractZodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export interface ErrorResponse {
  error: string;
  code: string;
  details?: unknown;
}

/**
* Create standardized error response
* @deprecated Use createErrorResponse from packages/errors instead
*/
export function createErrorResponseLegacy(
  error: string,
  code?: string,
  details?: unknown
): ErrorResponse {
  // P3: Always sanitize error details regardless of environment
  // Use type assertion to allow sanitization properties
  const response = { error, code: code || 'INTERNAL_ERROR' } as ErrorResponse & { message?: undefined; stack?: undefined };
  response.message = undefined;
  response.stack = undefined;
  response.details = undefined;
  return response;
}

/**
* Send error response with proper status code
*/
export function sendError(
  res: FastifyReply,
  status: number,
  error: string,
  code: string = 'INTERNAL_ERROR',
  details?: unknown
) {
  return res.status(status).send(createErrorResponseLegacy(error, code, details));
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
  return handler(req, res, result.data);
  };
}

/**
* Validation middleware factory for query validation
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
    'Validation failed',
    'VALIDATION_ERROR',
    extractZodIssues(result["error"])
    );
  }
  return handler(req, res, result.data);
  };
}

/**
* Validation middleware factory for params validation
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
    'Invalid parameters',
    'INVALID_PARAMS',
    extractZodIssues(result["error"])
    );
  }
  return handler(req, res, result.data);
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
  uuid: z.string().uuid(),
  idParam: z.object({
  id: z.string().uuid(),
  }),
  pagination: z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(ValidationConstants.MAX_PAGE_SIZE).default(ValidationConstants.DEFAULT_PAGE_SIZE),
  }),
  cursorPagination: z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(ValidationConstants.MAX_PAGE_SIZE).default(ValidationConstants.DEFAULT_PAGE_SIZE),
  }),
};
