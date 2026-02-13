/**
 * @deprecated Import from @kernel/retry directly.
 * This module re-exports resilience utilities for backward compatibility.
 */

// Core resilience utilities — canonical implementations in packages/kernel/retry.ts
export {
  withTimeout,
  CircuitBreaker,
  CircuitOpenError,
  withCircuitBreaker,
  type CircuitBreakerOptions,
} from '@kernel/retry';

// App-specific adapter names (not part of kernel)
const VALID_ADAPTER_NAMES = ['google-analytics', 'facebook', 'gsc', 'vercel', 'instagram', 'youtube', 'pinterest', 'linkedin', 'mailchimp', 'constant-contact', 'aweber'] as const;
export type ValidAdapterName = typeof VALID_ADAPTER_NAMES[number];

// Re-export CircuitBreakerConfig as an alias to CircuitBreakerOptions for backward compat
export type { CircuitBreakerOptions as CircuitBreakerConfig } from '@kernel/retry';
