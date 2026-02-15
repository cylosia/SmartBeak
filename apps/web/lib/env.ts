/**
 * Web App Environment Module
 *
 * This is a thin wrapper that re-exports from the shared @config package.
 * This eliminates code duplication while maintaining backward compatibility
 * with existing relative imports (e.g., '../../../lib/env').
 *
 * For new code, consider importing directly from @config.
 */

export {
  validateEnv,
  requireEnv,
  getEnv,
  getEnvWithDefault,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
} from '@config';

export { isProduction, isDevelopment } from '@config';
