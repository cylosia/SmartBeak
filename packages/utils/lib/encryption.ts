import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT = "smartbeak-integration-keys";

function deriveKey(secret: string): Buffer {
	return scryptSync(secret, SALT, KEY_LENGTH);
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Output format: [12-byte IV][16-byte auth tag][ciphertext]
 */
export function encrypt(plaintext: string, secret: string): Buffer {
	const key = deriveKey(secret);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts a buffer produced by `encrypt` back to plaintext.
 * Expects format: [12-byte IV][16-byte auth tag][ciphertext]
 */
export function decrypt(encrypted: Buffer, secret: string): string {
	try {
		const key = deriveKey(secret);
		const iv = encrypted.subarray(0, IV_LENGTH);
		const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
		const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

		const decipher = createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(authTag);

		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	} catch {
		throw new Error("Failed to decrypt data");
	}
}
