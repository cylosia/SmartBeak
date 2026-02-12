/**
 * AUDIT-FIX P0-04/P0-05: This file previously registered an UNAUTHENTICATED
 * /roi-risk/:assetId route that used SELECT * without org-scoping.
 *
 * It has been removed because:
 * 1. No authentication or authorization checks
 * 2. No org_id scoping (IDOR vulnerability)
 * 3. SELECT * exposing all columns including internal fields
 * 4. Duplicate of the properly-secured route in ./routes/roi-risk.ts
 *
 * The authenticated version lives at: control-plane/api/routes/roi-risk.ts
 * which implements:
 * - Auth context verification
 * - Role-based access control (requireRole)
 * - Asset ownership verification (verifyAssetOwnership with org_id)
 * - Explicit column selection
 * - Rate limiting
 * - IDOR logging
 */

// No routes exported - use routes/roi-risk.ts instead
