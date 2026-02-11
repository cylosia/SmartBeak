

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
let envValidationError: Error | null = null;

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
    envValidationError = new Error(
    'Missing required Clerk environment variables: ' +
    (!secretKey ? 'CLERK_SECRET_KEY ' : '') +
    (!publishableKey ? 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' : '')
    );
  }
  } catch (error) {
  envValidationError = error as Error;
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
* Lazy getter for webhook secret
* Returns empty string if not configured (non-critical)
*/
export function getClerkWebhookSecret(): string {
  return getWebhookSecretInternal();
}

// Backward compatibility: export a getter that can be called
export { getClerkWebhookSecret as getWebhookSecret };

/**
* Legacy exports for backward compatibility
* These will throw errors if accessed when env vars are not set

*/
Object.defineProperty(exports, 'CLERK_PUBLISHABLE_KEY', {
  get: getClerkPublishableKey,
  enumerable: true,
  configurable: true,
});

Object.defineProperty(exports, 'CLERK_SECRET_KEY', {
  get: getClerkSecretKey,
  enumerable: true,
  configurable: true,
});

Object.defineProperty(exports, 'CLERK_WEBHOOK_SECRET', {
  get: getClerkWebhookSecret,
  enumerable: true,
  configurable: true,
});
