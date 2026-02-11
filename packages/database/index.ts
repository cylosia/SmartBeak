// P1-FIX: Removed BOM character
/**
 * Shared Database Package
 * Database connection, utilities, and helpers
 *
 * This package provides centralized database management to prevent
 * cross-boundary imports between apps.
 *
 * P2-MEDIUM FIXES ADDED:
 * - JSONB size validation
 * - Enhanced DB error sanitization
 * - Sequence monitoring utilities
 */

// Re-export from modular structure
export * from './pool';
export * from './knex';
export * from './transactions';
export * from './jsonb';
export * from './errors';
export * from './health';

// P2-MEDIUM: Database maintenance utilities
export * as maintenance from './maintenance';

// P2-PERFORMANCE: Query optimization utilities
export * as queryOptimization from './query-optimization';
