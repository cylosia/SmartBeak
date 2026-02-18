

/**
* Clerk authentication configuration
* Validates environment variables at runtime using lazy evaluation
* to prevent crashes during module import
*

*/

/**
* Lazy validation state
*/
let envValidated = false;
let _envValidationError: Error | null = null;

/**
* Perform environment validation on first use
* Does not throw at module load - only when values are actually accessed
*/
function performEnvValidation(): void {
  if (envValidated) return;
  envValidated = true;

  // Only validate in production - dev/test can have missing env vars
  if (process.env['NODE_ENV'] !== 'production') {
  return;
  }

  try {
  // Check existence without throwing - actual access will throw if missing
  const secretKey = process.env['CLERK_SECRET_KEY'];
  const publishableKey = process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'];

  if (!secretKey || !publishableKey) {
    _envValidationError = new Error(
    'Missing required Clerk environment variables: ' +
    (!secretKey ? 'CLERK_SECRET_KEY ' : '') +
    (!publishableKey ? 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' : '')
    );
  }
  } catch (error) {
  _envValidationError = error as Error;
  }
}

/**
* Lazy evaluation helper for environment variables
* Prevents crashes during module import when env vars are not set
*/
function createLazyEnvGetter(
  envVarName: string,
  validator?: (value: string) => void
): () => string {
  let cachedValue: string | undefined;
  let validationPerformed = false;

  return function getEnvValue(): string {
  // Perform validation check on first access
  if (!validationPerformed) {
    validationPerformed = true;
    performEnvValidation();
  }

  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const value = process.env[envVarName];

  if (!value) {
    throw new Error(
    `${envVarName} is not set. ` +
    `Please set your actual ${envVarName} from https://dashboard.clerk.dev`
    );
  }

  if (validator) {
    validator(value);
  }

  cachedValue = value;
  return cachedValue;
  };
}

/**
* Validates that the key doesn't contain placeholder values
*/
function validateNoPlaceholder(value: string, name: string): void {
  if (value.includes('placeholder')) {
  throw new Error(
    `${name} contains a placeholder value. ` +
    `Please set your actual ${name} from https://dashboard.clerk.dev`
  );
  }
}

/**
* Clerk publishable key (client-side)
* Used for frontend Clerk components

*/
export const getClerkPublishableKey = createLazyEnvGetter(
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  (value) => validateNoPlaceholder(value, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')
);

// Backward compatibility: export a getter that can be called
export { getClerkPublishableKey as getPublishableKey };

/**
* Clerk secret key (server-side only)
* Never expose this to the client

*/
export const getClerkSecretKey = createLazyEnvGetter(
  'CLERK_SECRET_KEY',
  (value) => validateNoPlaceholder(value, 'CLERK_SECRET_KEY')
);

// Backward compatibility: export a getter that can be called
export { getClerkSecretKey as getSecretKey };

/**
* Clerk webhook secret for verifying webhook signatures

* Note: This is optional - returns empty string if not set
*/
function getWebhookSecretInternal(): string {
  const value = process.env['CLERK_WEBHOOK_SECRET'];
  return value || '';
}

/**
* Getter for webhook secret.
* P1-010 FIX: Throws instead of returning empty string when unset.
* A missing webhook secret causes signature verification to accept any payload.
*/
export function getClerkWebhookSecret(): string {
  const value = getWebhookSecretInternal();
  if (!value) {
    throw new Error(
      'CLERK_WEBHOOK_SECRET is not set. ' +
      'Please configure your actual webhook secret from https://dashboard.clerk.dev'
    );
  }
  return value;
}

// Backward compatibility: export a getter that can be called
export { getClerkWebhookSecret as getWebhookSecret };

// P0-006 FIX: Removed Object.defineProperty(exports, ...) blocks.
// Those were CommonJS syntax that throws ReferenceError in ESM ("type":"module").
// All three names are already available via the named exports above:
//   getClerkPublishableKey / getPublishableKey
//   getClerkSecretKey     / getSecretKey
//   getClerkWebhookSecret / getWebhookSecret
