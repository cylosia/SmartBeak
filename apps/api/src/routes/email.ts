/**
* Email Routes (Re-export)
* P2-MEDIUM FIX: God class broken up into modular structure
*
* The original 554-line file has been refactored into:
* - email/types.ts - Types and Zod schemas with strict() validation
* - email/utils.ts - Utility functions (whitelistFields, security headers)
* - email/auth.ts - JWT verification and domain access control
* - email/audit.ts - Audit logging
* - email/index.ts - Route handlers (with HSTS headers and error: unknown fixes)
*
* Changes applied:
* 1. Architecture: Broken up God class (>500 lines) into modules
* 2. Security: Added HSTS headers
* 3. Type Safety: Changed error: any to error: unknown
* 4. Validation: Added Zod strict() schemas
*/

// Re-export for backward compatibility
export { emailRoutes as default } from './email/index';
