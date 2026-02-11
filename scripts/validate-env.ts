#!/usr/bin/env tsx
/**
 * Environment Variable Validation Script
 * Run this before building or deploying to ensure all required env vars are set
 *
 * Usage:
 *   npx tsx scripts/validate-env.ts
 *   npm run validate-env
 */

import { validateEnv } from '@config';
import { getLogger } from '../packages/kernel/logger';

const logger = getLogger('ValidateEnv');

logger.info('Validating environment variables');

try {
  validateEnv();
  logger.info('All required environment variables are set');
  process.exit(0);
} catch (error: unknown) {
  logger.error('Environment validation failed', error instanceof Error ? error : undefined);
  process.exit(1);
}
