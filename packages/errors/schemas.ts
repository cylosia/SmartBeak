/**
 * Zod schemas for the canonical error response shape.
 * Used for both runtime validation and OpenAPI spec generation.
 */

import { z } from 'zod';
import { ErrorCodes } from './index.js';

const errorCodeValues = Object.values(ErrorCodes) as [string, ...string[]];

/**
 * Canonical ErrorResponse Zod schema.
 * Every 4xx/5xx response from the API must conform to this shape.
 */
export const ErrorResponseSchema = z.object({
  error: z.string().describe('Human-readable error message'),
  code: z.enum(errorCodeValues).describe('Machine-readable error code'),
  requestId: z.string().describe('Request ID for tracing'),
  details: z.unknown().optional().describe('Additional details (development only)'),
  retryAfter: z.number().int().positive().optional().describe('Seconds until retry is allowed (429 only)'),
});

export type ErrorResponseType = z.infer<typeof ErrorResponseSchema>;
