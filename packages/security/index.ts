

/**
 * Security Package
 * Authentication helpers, audit logging, SSRF protection, and security utilities
 */

// Audit logging
export { AuditLogger } from './audit';

// Key rotation
export { KeyRotationManager } from './keyRotation';

// Security and session management
export { 
  SessionManager, 
  SecurityAlertManager, 
  generateDeviceFingerprint, 
  sessionManager, 
  securityAlertManager 
} from './security';

// SSRF Protection
export {
  isInternalIp,
  isAllowedProtocol,
  isAllowedPort,
  validateUrl,
  validateUrlWithDns,
  validateUrlWithDnsCheck,
  validateResolvedIps,
  extractSafeUrl,
  normalizeIp,
  type SSRFValidationResult,
} from './ssrf';

// JWT Authentication
export {
  // Main functions
  verifyToken,
  extractAndVerifyToken,
  getAuthContext,
  requireAuthContext,
  validateTokenFormat,
  validateAuthHeaderConstantTime,
  constantTimeCompare,
  logAuthEvent,
  // Token extraction
  extractBearerToken,
  // Types
  type AuthContext,
  type UserRole,
  type JwtClaims,
  type VerifyOptions,
  // Schemas
  UserRoleSchema,
  JwtClaimsSchema,
  // Errors
  AuthError,
  TokenExpiredError,
  TokenInvalidError,
} from './jwt';

// Legacy auth exports for backward compatibility
export {
  requireAuthNextJs,
  optionalAuthNextJs,
  verifyAuthHeader,
  hasRequiredRole,
  roleHierarchy,
  optionalAuthFastify,
  requireAuthFastify,
  type FastifyAuthContext,
} from './auth';

// Input validation
export {
  isValidUUID,
  sanitizeHtmlTags,
  sanitizeEventHandlers,
  sanitizeString,
  isValidUrlEncoding,
  safeDecodeURIComponent,
  validateAndNormalizeUrl,
  isValidContentType,
  getNormalizedContentType,
  validateQueryParam,
  validatePaginationParams,
  ValidationSchemas,
} from './input-validator';
