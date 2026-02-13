/**
 * P1 TEST: Unified Error Handling Package Tests
 *
 * Tests AppError hierarchy, error codes, HTTP status mapping,
 * serialization, sanitization, and helper functions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorCodes,
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  DatabaseError,
  RateLimitError,
  ConflictError,
  ServiceUnavailableError,
  PayloadTooLargeError,
  sanitizeErrorForClient,
  createErrorResponse,
  getStatusCodeForErrorCode,
  extractZodIssues,
  formatZodError,
  shouldExposeErrorDetails,
  safeStringifyError,
} from '../index';

// Mock the logger
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Error Handling Package', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['NODE_ENV'];
    delete process.env['DEBUG'];
  });

  // ============================================================================
  // ErrorCodes
  // ============================================================================

  describe('ErrorCodes', () => {
    it('should have VALIDATION_ERROR', () => {
      expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    });

    it('should have AUTH_ERROR', () => {
      expect(ErrorCodes.AUTH_ERROR).toBe('AUTH_ERROR');
    });

    it('should have NOT_FOUND', () => {
      expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
    });

    it('should have INTERNAL_ERROR', () => {
      expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });

    it('should be frozen/readonly', () => {
      expect(Object.isFrozen(ErrorCodes)).toBe(true);
    });
  });

  // ============================================================================
  // AppError
  // ============================================================================

  describe('AppError', () => {
    it('should create with defaults', () => {
      const err = new AppError('Something went wrong');
      expect(err.message).toBe('Something went wrong');
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.statusCode).toBe(500);
      expect(err.details).toBeUndefined();
      expect(err.requestId).toBeUndefined();
    });

    it('should create with all params', () => {
      const err = new AppError('Bad input', ErrorCodes.VALIDATION_ERROR, 400, { field: 'email' }, 'req-123');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.statusCode).toBe(400);
      expect(err.details).toEqual({ field: 'email' });
      expect(err.requestId).toBe('req-123');
    });

    it('should extend Error', () => {
      const err = new AppError('test');
      expect(err).toBeInstanceOf(Error);
      expect(err.stack).toBeDefined();
    });

    it('toJSON should serialize correctly', () => {
      const err = new AppError('Bad input', ErrorCodes.VALIDATION_ERROR, 400, { field: 'x' }, 'req-1');
      const json = err.toJSON();
      expect(json.error).toBe('Bad input');
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.details).toEqual({ field: 'x' });
      expect(json.requestId).toBe('req-1');
    });

    it('toJSON should omit undefined details/requestId', () => {
      const err = new AppError('test');
      const json = err.toJSON();
      expect('details' in json).toBe(false);
      expect('requestId' in json).toBe(false);
    });

    it('toClientJSON should hide details in production', () => {
      process.env['NODE_ENV'] = 'production';
      const err = new AppError('Bad input', ErrorCodes.VALIDATION_ERROR, 400, { secret: 'data' }, 'req-1');
      const json = err.toClientJSON();
      expect('details' in json).toBe(false);
      expect('requestId' in json).toBe(false);
    });

    it('toClientJSON should show details in development', () => {
      process.env['NODE_ENV'] = 'development';
      const err = new AppError('Bad input', ErrorCodes.VALIDATION_ERROR, 400, { field: 'x' }, 'req-1');
      const json = err.toClientJSON();
      expect(json.details).toEqual({ field: 'x' });
      expect(json.requestId).toBe('req-1');
    });
  });

  // ============================================================================
  // Specific Error Classes
  // ============================================================================

  describe('ValidationError', () => {
    it('should default to 400', () => {
      const err = new ValidationError();
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('should create from Zod issues', () => {
      const issues = [{ path: ['email'], message: 'Required', code: 'invalid_type' }];
      const err = ValidationError.fromZodIssues(issues);
      expect(err.details).toHaveLength(1);
    });
  });

  describe('AuthError', () => {
    it('should default to 401', () => {
      const err = new AuthError();
      expect(err.statusCode).toBe(401);
    });

    it('tokenInvalid factory', () => {
      const err = AuthError.tokenInvalid();
      expect(err.code).toBe('INVALID_TOKEN');
    });

    it('tokenExpired factory', () => {
      const err = AuthError.tokenExpired();
      expect(err.code).toBe('TOKEN_EXPIRED');
    });

    it('required factory', () => {
      const err = AuthError.required();
      expect(err.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('ForbiddenError', () => {
    it('should default to 403', () => {
      const err = new ForbiddenError();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });
  });

  describe('NotFoundError', () => {
    it('should default to 404', () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Resource not found');
    });

    it('content factory', () => {
      const err = NotFoundError.content();
      expect(err.code).toBe('CONTENT_NOT_FOUND');
    });

    it('domain factory', () => {
      const err = NotFoundError.domain();
      expect(err.code).toBe('DOMAIN_NOT_FOUND');
    });

    it('user factory', () => {
      const err = NotFoundError.user();
      expect(err.code).toBe('USER_NOT_FOUND');
    });

    it('intent factory', () => {
      const err = NotFoundError.intent();
      expect(err.code).toBe('INTENT_NOT_FOUND');
    });
  });

  describe('DatabaseError', () => {
    it('should default to 500', () => {
      const err = new DatabaseError();
      expect(err.statusCode).toBe(500);
    });

    it('fromDBError should sanitize connection errors', () => {
      const err = DatabaseError.fromDBError(new Error('ECONNREFUSED 127.0.0.1:5432'));
      expect(err.message).toContain('connection error');
    });

    it('fromDBError should sanitize timeout errors', () => {
      const err = DatabaseError.fromDBError(new Error('query timeout exceeded'));
      expect(err.message).toContain('timeout');
    });

    it('fromDBError should sanitize duplicate key errors', () => {
      const err = DatabaseError.fromDBError(new Error('duplicate key value violates unique constraint'));
      expect(err.message).toContain('already exists');
    });

    it('fromDBError should return generic message for unknown DB errors', () => {
      const err = DatabaseError.fromDBError(new Error('unexpected pg error'));
      expect(err.message).toContain('unexpected database error');
    });
  });

  describe('RateLimitError', () => {
    it('should default to 429 with retryAfter', () => {
      const err = new RateLimitError();
      expect(err.statusCode).toBe(429);
      expect(err.retryAfter).toBe(60);
    });

    it('toJSON should include retryAfter', () => {
      const err = new RateLimitError('slow down', 30);
      const json = err.toJSON();
      expect(json.retryAfter).toBe(30);
    });
  });

  describe('ConflictError', () => {
    it('should default to 409', () => {
      expect(new ConflictError().statusCode).toBe(409);
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should default to 503', () => {
      expect(new ServiceUnavailableError().statusCode).toBe(503);
    });
  });

  describe('PayloadTooLargeError', () => {
    it('should default to 413', () => {
      expect(new PayloadTooLargeError().statusCode).toBe(413);
    });
  });

  // ============================================================================
  // Helper Functions
  // ============================================================================

  describe('sanitizeErrorForClient', () => {
    it('should use toClientJSON for AppError instances', () => {
      const err = new ValidationError('bad input', { field: 'email' });
      const result = sanitizeErrorForClient(err);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should return generic message for unknown errors', () => {
      const result = sanitizeErrorForClient(new Error('internal details'));
      expect(result.error).toBe('An error occurred processing your request');
      expect(result.code).toBe('INTERNAL_ERROR');
    });

    it('should sanitize database-related errors', () => {
      const result = sanitizeErrorForClient(new Error('postgres connection failed'));
      expect(result.code).toBe('DATABASE_ERROR');
    });

    it('should handle non-Error values', () => {
      const result = sanitizeErrorForClient('string error');
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('createErrorResponse', () => {
    it('should create basic error response', () => {
      const result = createErrorResponse('Something failed');
      expect(result.error).toBe('Something failed');
      expect(result.code).toBe('INTERNAL_ERROR');
    });

    it('should include requestId when provided', () => {
      const result = createErrorResponse('fail', ErrorCodes.VALIDATION_ERROR, undefined, 'req-1');
      expect(result.requestId).toBe('req-1');
    });

    it('should hide details in production', () => {
      process.env['NODE_ENV'] = 'production';
      const result = createErrorResponse('fail', ErrorCodes.INTERNAL_ERROR, { secret: true });
      expect('details' in result).toBe(false);
    });

    it('should show details in development', () => {
      process.env['NODE_ENV'] = 'development';
      const result = createErrorResponse('fail', ErrorCodes.INTERNAL_ERROR, { debug: true });
      expect(result.details).toEqual({ debug: true });
    });
  });

  describe('getStatusCodeForErrorCode', () => {
    it('should map validation errors to 400', () => {
      expect(getStatusCodeForErrorCode(ErrorCodes.VALIDATION_ERROR)).toBe(400);
      expect(getStatusCodeForErrorCode(ErrorCodes.INVALID_PARAMS)).toBe(400);
    });

    it('should map auth errors to 401', () => {
      expect(getStatusCodeForErrorCode(ErrorCodes.AUTH_ERROR)).toBe(401);
      expect(getStatusCodeForErrorCode(ErrorCodes.TOKEN_EXPIRED)).toBe(401);
    });

    it('should map forbidden errors to 403', () => {
      expect(getStatusCodeForErrorCode(ErrorCodes.FORBIDDEN)).toBe(403);
    });

    it('should map not found errors to 404', () => {
      expect(getStatusCodeForErrorCode(ErrorCodes.NOT_FOUND)).toBe(404);
      expect(getStatusCodeForErrorCode(ErrorCodes.CONTENT_NOT_FOUND)).toBe(404);
    });

    it('should map rate limit to 429', () => {
      expect(getStatusCodeForErrorCode(ErrorCodes.RATE_LIMIT_EXCEEDED)).toBe(429);
    });

    it('should map internal error to 500', () => {
      expect(getStatusCodeForErrorCode(ErrorCodes.INTERNAL_ERROR)).toBe(500);
    });
  });

  describe('extractZodIssues', () => {
    it('should extract from .issues array', () => {
      const error = { issues: [{ path: ['a'], message: 'required', code: 'invalid_type' }] };
      const result = extractZodIssues(error);
      expect(result).toHaveLength(1);
      expect(result[0].path).toEqual(['a']);
    });

    it('should fallback to .errors array', () => {
      const error = { errors: [{ path: ['b'], message: 'too short', code: 'too_small' }] };
      const result = extractZodIssues(error);
      expect(result).toHaveLength(1);
    });

    it('should return empty for non-object', () => {
      expect(extractZodIssues(null)).toEqual([]);
      expect(extractZodIssues('string')).toEqual([]);
    });
  });

  describe('formatZodError', () => {
    it('should format issues into message', () => {
      const error = { issues: [{ path: ['email'], message: 'Required', code: 'invalid_type' }] };
      const result = formatZodError(error);
      expect(result.message).toContain('Required');
      expect(result.issues).toHaveLength(1);
    });

    it('should return default message for empty issues', () => {
      const result = formatZodError({});
      expect(result.message).toBe('Validation failed');
    });
  });

  describe('shouldExposeErrorDetails', () => {
    it('should return true in development', () => {
      process.env['NODE_ENV'] = 'development';
      expect(shouldExposeErrorDetails()).toBe(true);
    });

    it('should return true when DEBUG is true', () => {
      process.env['DEBUG'] = 'true';
      expect(shouldExposeErrorDetails()).toBe(true);
    });

    it('should return false in production', () => {
      process.env['NODE_ENV'] = 'production';
      expect(shouldExposeErrorDetails()).toBe(false);
    });
  });

  describe('safeStringifyError', () => {
    it('should stringify Error instances', () => {
      const result = safeStringifyError(new Error('test'));
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('Error');
      expect(parsed.message).toBe('test');
    });

    it('should handle non-Error values', () => {
      expect(safeStringifyError('string error')).toBe('"string error"');
      expect(safeStringifyError(42)).toBe('42');
    });

    it('should handle circular references gracefully', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const result = safeStringifyError(circular);
      expect(typeof result).toBe('string');
    });
  });
});
