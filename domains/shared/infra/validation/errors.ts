/**
 * Shared Validation Errors
 *
 * P0-SECURITY FIX: This file previously defined a DUPLICATE ValidationError class
 * with SWAPPED constructor parameters (message, code, field) vs the canonical
 * (message, field, code) in packages/kernel/validation/types-base.ts.
 *
 * This re-export ensures a single source of truth.
 * Do NOT define a local ValidationError class here.
 */
export { ValidationError } from '../../../../packages/kernel/validation/types-base';
