import crypto from 'crypto';
import { z } from 'zod';

/**
* Idempotency Utilities
* Provides functions for generating deterministic keys and handling idempotent operations
*/

// ============================================================================
// Zod Schemas
// ============================================================================

export const IdempotencyKeyPartsSchema = z.array(z.string().min(1).max(1024)).min(1).max(10);

export const IdempotencyKeyOptionsSchema = z.object({
  prefix: z.string().min(1).max(50).optional(),
  suffix: z.string().min(1).max(50).optional(),
  algorithm: z.enum(['sha256', 'sha512', 'md5']).default('sha256'),
  encoding: z.enum(['hex', 'base64', 'base64url']).default('hex'),
});

export const IdempotencyRecordSchema = z.object({
  key: z.string(),
  payload: z.record(z.string(), z.unknown()),
  response: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
  expiresAt: z.date(),
  status: z.enum(['pending', 'completed', 'failed']),
});

// ============================================================================
// Type Definitions
// ============================================================================

export type IdempotencyKeyParts = z.infer<typeof IdempotencyKeyPartsSchema>;
export type IdempotencyKeyOptions = z.infer<typeof IdempotencyKeyOptionsSchema>;
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;

export interface DeterministicKeyResult {
  key: string;
  algorithm: string;
  encoding: string;
}

export interface IdempotencyContext<TPayload = unknown, TResponse = unknown> {
  key: string;
  payload: TPayload;
  response?: TResponse;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'completed' | 'failed';
}

// ============================================================================
// Error Types
// ============================================================================

export class IdempotencyError extends Error {
  constructor(
  message: string,
  public readonly code: string,
  public readonly key?: string
  ) {
  super(message);
  this.name = 'IdempotencyError';
  }
}

export class InvalidKeyPartsError extends IdempotencyError {
  constructor(message: string) {
  super(message, 'INVALID_KEY_PARTS');
  this.name = 'InvalidKeyPartsError';
  }
}

export class UnsupportedAlgorithmError extends IdempotencyError {
  constructor(algorithm: string) {
  super(`Unsupported hash algorithm: ${algorithm}`, 'UNSUPPORTED_ALGORITHM');
  this.name = 'UnsupportedAlgorithmError';
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ALGORITHM = 'sha256';
const DEFAULT_ENCODING: BinaryToTextEncoding = 'hex';
// Pre-compiled regex patterns for key format validation (per-encoding, not always hex)
const HEX_PATTERN = /^[a-f0-9]+$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/;
// Base64url does NOT use padding characters; RFC 4648 §5 prohibits '=' in url-safe alphabet
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

// ============================================================================
// Hash Algorithm Utilities
// ============================================================================

/**
* Validate and normalize hash algorithm
*/
type HashAlgorithm = 'sha256' | 'sha512' | 'md5';

function validateAlgorithm(algorithm: string): HashAlgorithm {
  const validAlgorithms: HashAlgorithm[] = ['sha256', 'sha512', 'md5'];
  if (!validAlgorithms.includes(algorithm as HashAlgorithm)) {
  throw new UnsupportedAlgorithmError(algorithm);
  }
  return algorithm as HashAlgorithm;
}

/**
* Validate and normalize encoding
*/
type BinaryToTextEncoding = 'hex' | 'base64' | 'base64url';

function validateEncoding(encoding: string): BinaryToTextEncoding {
  const validEncodings: BinaryToTextEncoding[] = ['hex', 'base64', 'base64url'];
  if (!validEncodings.includes(encoding as BinaryToTextEncoding)) {
  return DEFAULT_ENCODING;
  }
  return encoding as BinaryToTextEncoding;
}

// ============================================================================
// Key Generation Functions
// ============================================================================

/**
* Generate a deterministic key from parts using SHA256 hash
* This ensures consistent key generation across distributed systems
*
* @param parts - Array of string parts to hash
* @returns Hex-encoded SHA256 hash of joined parts
* @throws {InvalidKeyPartsError} When parts array is empty or invalid
*
* @example
* ```typescript
* const key = deterministicKey(['user', '123', 'create-order']);
* // Returns: 'a3f5c2...' (64 character hex string)
* ```
*/
export function deterministicKey(parts: string[]): string {
  // Validate input
  const validatedParts = IdempotencyKeyPartsSchema.safeParse(parts);
  if (!validatedParts.success) {
  throw new InvalidKeyPartsError(
    `Invalid key parts: ${validatedParts.error.issues.map((e) => e["message"]).join(', ')}`
  );
  }

  // Join parts with colon separator and create hash
  const joined = validatedParts.data.join(':');

  return crypto
  .createHash(DEFAULT_ALGORITHM)
  .update(joined)
  .digest(DEFAULT_ENCODING);
}

/**
* Generate a deterministic key with custom options
*
* @param parts - Array of string parts to hash
* @param options - Options for key generation
* @returns Object containing the key and metadata
* @throws {InvalidKeyPartsError} When parts array is empty or invalid
* @throws {UnsupportedAlgorithmError} When algorithm is not supported
*
* @example
* ```typescript
* const result = deterministicKeyWithOptions(
*   ['user', '123', 'payment'],
*   { prefix: 'idemp', algorithm: 'sha512', encoding: 'base64' }
* );
* // Returns: { key: 'idemp:AbCdEf...', algorithm: 'sha512', encoding: 'base64' }
* ```
*/
export function deterministicKeyWithOptions(
  parts: string[],
  options?: IdempotencyKeyOptions
): DeterministicKeyResult {
  // Validate inputs
  const validatedParts = IdempotencyKeyPartsSchema.safeParse(parts);
  if (!validatedParts.success) {
  throw new InvalidKeyPartsError(
    `Invalid key parts: ${validatedParts.error.issues.map((e) => e["message"]).join(', ')}`
  );
  }

  const validatedOptions = IdempotencyKeyOptionsSchema.parse(options);
  const algorithm = validateAlgorithm(validatedOptions.algorithm);
  const encoding = validateEncoding(validatedOptions.encoding);

  // Build key parts with optional prefix/suffix
  const keyParts: string[] = [];

  if (validatedOptions.prefix) {
  keyParts.push(validatedOptions.prefix);
  }

  keyParts.push(...validatedParts.data);

  if (validatedOptions.suffix) {
  keyParts.push(validatedOptions.suffix);
  }

  // Generate hash
  const joined = keyParts.join(':');
  const hash = crypto
  .createHash(algorithm)
  .update(joined)
  .digest(encoding);

  return {
  key: hash,
  algorithm: algorithm,
  encoding: encoding,
  };
}

/**
* Generate a prefixed idempotency key for a specific context
*
* @param context - Context identifier (e.g., 'payment', 'user-create')
* @param identifier - Unique identifier within the context
* @returns Prefixed idempotency key
*
* @example
* ```typescript
* const key = generateIdempotencyKey('payment', 'user-123:order-456');
* // Returns: 'idemp:payment:abc123...'
* ```
*/
export function generateIdempotencyKey(context: string, identifier: string): string {
  return deterministicKey(['idemp', context, identifier]);
}

/**
* Generate a request-scoped idempotency key
* Combines multiple request attributes for uniqueness
*
* @param params - Request parameters
* @returns Deterministic key
*/
export function generateRequestKey(params: {
  userId: string;
  action: string;
  resourceId: string;
  timestamp?: string;
}): string {
  const parts = [params.userId, params.action, params.resourceId];
  if (params.timestamp) {
  parts.push(params.timestamp);
  }
  return deterministicKey(parts);
}

/**
* Validate that a string is a valid idempotency key format
*
* @param key - Key to validate
* @param algorithm - Hash algorithm used (defaults to 'sha256')
* @param encoding - Encoding used for the key (defaults to 'hex')
* @returns Whether the key is valid
*/
export function isValidIdempotencyKey(key: string, algorithm: string = 'sha256', encoding: string = 'hex'): boolean {
  if (typeof key !== 'string') return false;

  // Expected character lengths for hex-encoded digests
  const hexLengths: Record<string, number> = {
    md5: 32,
    sha256: 64,
    sha512: 128,
  };

  // For hex encoding, validate exact length and character set
  if (encoding === 'hex') {
    const expectedLength = hexLengths[algorithm];
    if (!expectedLength) return false;
    if (key.length !== expectedLength) return false;
    return HEX_PATTERN.test(key);
  }

  // For base64/base64url, validate character set only (length varies due to padding)
  if (encoding === 'base64') {
    return BASE64_PATTERN.test(key);
  }

  if (encoding === 'base64url') {
    return BASE64URL_PATTERN.test(key);
  }

  return false;
}

// ============================================================================
// Payload Hashing Utilities
// ============================================================================

/**
* Type guard to check if value is a plain object
* P2-MEDIUM FIX: Type guard instead of as assertion
*/
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
* Deep sort object keys recursively for deterministic serialization
* Handles nested objects, arrays, and circular references
*
* @param obj - Object to sort keys on
* @param seen - WeakSet to track circular references
* @returns Deep-sorted object
*/
function sortKeysDeep(obj: unknown, seen = new WeakSet<object>()): unknown {
  // Handle primitives and null
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sortKeysDeep(item, seen));
  }

  // P2-MEDIUM FIX: Use type guard instead of as object
  if (!isPlainObject(obj)) {
    return obj;
  }

  // Handle circular references
  if (seen.has(obj)) {
    return '[Circular]';
  }
  seen.add(obj);

  // Handle objects - sort keys and recursively process values
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortKeysDeep(obj[key], seen);
      return acc;
    }, {});
}

/**
* Create a hash of a payload for comparison
* Used to detect payload changes for the same idempotency key
*
* @param payload - Payload to hash
* @returns Hash of the payload
* MEDIUM FIX M15: Bounded payload size for hashing
*/
export function hashPayload<T extends Record<string, unknown>>(payload: T): string {
  const sortedPayload = sortKeysDeep(payload);
  const serialized = JSON.stringify(sortedPayload);

  // Use byte length (not character count) to correctly bound multi-byte Unicode payloads.
  // A payload of 5M multi-byte chars can exceed 10MB in UTF-8 bytes.
  const MAX_PAYLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  const sizeInBytes = Buffer.byteLength(serialized, 'utf8');
  if (sizeInBytes > MAX_PAYLOAD_SIZE_BYTES) {
  throw new IdempotencyError(
    `Payload size ${sizeInBytes} bytes exceeds maximum ${MAX_PAYLOAD_SIZE_BYTES} bytes`,
    'PAYLOAD_TOO_LARGE'
  );
  }

  return crypto
  .createHash(DEFAULT_ALGORITHM)
  .update(serialized)
  .digest(DEFAULT_ENCODING);
}

/**
* Compare two payloads for equality using a timing-safe comparison.
*
* Using `===` on hash strings leaks timing information: the comparison exits
* at the first differing byte, so an attacker can infer partial hash values
* through repeated measurements. `crypto.timingSafeEqual` always takes
* constant time regardless of where the bytes diverge.
*
* @param payload1 - First payload
* @param payload2 - Second payload
* @returns Whether the payloads are equal
*/
export function payloadsEqual<T extends Record<string, unknown>>(payload1: T, payload2: T): boolean {
  const h1 = hashPayload(payload1);
  const h2 = hashPayload(payload2);
  // Both hashes are hex-encoded SHA-256 digests (64 chars), so lengths are equal.
  // timingSafeEqual requires equal-length Buffers.
  if (h1.length !== h2.length) return false;
  return crypto.timingSafeEqual(Buffer.from(h1, 'utf8'), Buffer.from(h2, 'utf8'));
}
