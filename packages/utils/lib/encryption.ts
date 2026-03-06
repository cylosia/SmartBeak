import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scrypt,
} from "node:crypto";
import { promisify } from "node:util";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const scryptAsync = promisify(scrypt);

async function deriveKey(secret: string, salt: Buffer): Promise<Buffer> {
	return (await scryptAsync(secret, salt, KEY_LENGTH)) as Buffer;
}

/**
 * Encrypts plaintext using AES-256-GCM with a random per-message salt.
 * Output format: [16-byte salt][12-byte IV][16-byte auth tag][ciphertext]
 */
export async function encrypt(
	plaintext: string,
	secret: string,
): Promise<Buffer> {
	const salt = randomBytes(SALT_LENGTH);
	const key = await deriveKey(secret, salt);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * Decrypts a buffer produced by `encrypt` back to plaintext.
 * Expects format: [16-byte salt][12-byte IV][16-byte auth tag][ciphertext]
 */
export async function decrypt(
	encrypted: Buffer,
	secret: string,
): Promise<string> {
	try {
		const salt = encrypted.subarray(0, SALT_LENGTH);
		const key = await deriveKey(secret, salt);
		const iv = encrypted.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
		const authTag = encrypted.subarray(
			SALT_LENGTH + IV_LENGTH,
			SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
		);
		const ciphertext = encrypted.subarray(
			SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
		);

		const decipher = createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(authTag);

		return Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]).toString("utf8");
	} catch {
		throw new Error("Failed to decrypt data");
	}
}
