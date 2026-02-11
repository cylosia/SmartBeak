/**
* Email Subscriber Routes (Re-export)
* P2-MEDIUM FIX: God class broken up into modular structure
*
* The original 748-line file has been refactored into:
* - emailSubscribers/types.ts - Types and Zod schemas with strict() validation
* - emailSubscribers/rateLimit.ts - LRU rate limiting store
* - emailSubscribers/auth.ts - JWT verification and domain access control
* - emailSubscribers/audit.ts - Audit logging
* - emailSubscribers/index.ts - Route handlers (with HSTS headers and error: unknown fixes)
*
* Changes applied:
* 1. Architecture: Broken up God class (>500 lines) into modules
* 2. Security: Added HSTS headers
* 3. Type Safety: Changed error: any to error: unknown
* 4. Validation: Added Zod strict() schemas
* 5. Bug Fix: Fixed missing db variable import
*/

// Re-export for backward compatibility
export { emailSubscriberRoutes, cleanupRateLimitStore } from './emailSubscribers/index';
