/**
 * Web App Environment Module
 *
 * This is a thin wrapper that re-exports from the shared @config package.
 * This eliminates code duplication while maintaining backward compatibility
 * with existing relative imports (e.g., '../../../lib/env').
 *
 * For new code, consider importing directly from @config.
 */

import {
  validateEnv,
  requireEnv,
  getEnv,
  getEnvWithDefault,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
  isProduction,
  isDevelopment,
} from '@config';

export {
  validateEnv,
  requireEnv,
  getEnv,
  getEnvWithDefault,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
  isProduction,
  isDevelopment,
};

export default {
  validateEnv,
  requireEnv,
  getEnv,
  getEnvWithDefault,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
};
