/**
 * Enterprise cryptographic utilities.
 *
 * - AES-256-GCM encryption for SSO provider configs (secrets at rest).
 * - SHA-256 hashing for SCIM tokens (never store raw tokens).
 * - Secure random token generation for SCIM provisioning.
 */

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { ORPCError } from "@orpc/server";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
	if (cachedKey) {
		return cachedKey;
	}
	const key = process.env.ENTERPRISE_ENCRYPTION_KEY;
	if (!key) {
		throw new Error(
			"ENTERPRISE_ENCRYPTION_KEY is required. Set a 64-character hex string in your environment.",
		);
	}
	const buf = Buffer.from(key, "hex");
	if (buf.length !== 32) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "Encryption key misconfigured.",
		});
	}
	cachedKey = buf;
	return buf;
}

/**
 * Encrypts a JSON-serializable object using AES-256-GCM.
 * Returns a Buffer containing: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 */
export function encryptConfig(data: Record<string, unknown>): Buffer {
	const key = getEncryptionKey();
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const plaintext = Buffer.from(JSON.stringify(data), "utf8");
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, encrypted, tag]);
}

/**
 * Decrypts a Buffer produced by `encryptConfig`.
 * Returns the original JSON-serializable object.
 */
export function decryptConfig(data: Buffer): Record<string, unknown> {
	const key = getEncryptionKey();
	const iv = data.subarray(0, IV_LENGTH);
	const tag = data.subarray(data.length - TAG_LENGTH);
	const ciphertext = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);
	try {
		const decipher = createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(tag);
		const decrypted = Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]);
		return JSON.parse(decrypted.toString("utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Failed to decrypt configuration.",
		});
	}
}

/**
 * Generates a cryptographically secure SCIM bearer token.
 * Format: `smrt_scim_<32 random hex bytes>` (total ~72 chars).
 */
export function generateScimToken(): string {
	const random = randomBytes(32).toString("hex");
	return `smrt_scim_${random}`;
}

/**
 * Hashes a raw token using SHA-256 for safe database storage.
 */
export function hashToken(rawToken: string): string {
	return createHash("sha256").update(rawToken).digest("hex");
}
