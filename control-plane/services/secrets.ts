/**
* Assert that a required environment variable/secret is present
* @param name - Name of the environment variable
* @throws Error if the environment variable is not set
*/
export function assertSecretPresent(name: string): void {
  if (!name || typeof name !== 'string') {
  throw new Error('Secret name must be a non-empty string');
  }
  if (!process.env[name]) {
  throw new Error(`Missing required secret: ${name}`);
  }
}
