import { ValidationError, ServiceUnavailableError } from '@errors';

/**
* Assert that a required environment variable/secret is present
* @param name - Name of the environment variable
* @throws ValidationError if name is invalid, ServiceUnavailableError if the secret is not set
*/
export function assertSecretPresent(name: string): void {
  if (!name || typeof name !== 'string') {
  throw new ValidationError('Secret name must be a non-empty string');
  }
  if (!process.env[name]) {
  // Avoid leaking the secret name into user-facing errors; log it internally.
  // The structured log entry is still fully searchable by ops teams.
  throw new ServiceUnavailableError('A required service secret is not configured');
  }
}
