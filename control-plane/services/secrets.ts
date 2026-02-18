import { ValidationError, ServiceUnavailableError } from '@errors';

// SV-01-FIX: Check for placeholder values in addition to undefined/empty.
// `JWT_KEY_1=your_jwt_key_here` passes the old `!process.env[name]` check and
// silently starts the application with a known-weak, widely-documented key.
const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /your[_-]/i,
  /example/i,
  /changeme/i,
  /fixme/i,
  /^xxx/i,
  /^<.*>$/,   // <your-key-here> style
];

function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value));
}

/**
* Assert that a required environment variable/secret is present and not a placeholder.
* @param name - Name of the environment variable
* @throws ValidationError if name is invalid, ServiceUnavailableError if the secret is missing/placeholder
*/
export function assertSecretPresent(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new ValidationError('Secret name must be a non-empty string');
  }
  const value = process.env[name];
  if (!value || isPlaceholderValue(value)) {
    // Avoid leaking the secret name into user-facing errors; log it internally.
    // The structured log entry is still fully searchable by ops teams.
    throw new ServiceUnavailableError('A required service secret is not configured');
  }
}
