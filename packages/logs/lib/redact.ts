/**
 * Log redaction layer.
 *
 * Scans serialized log entries for sensitive patterns and replaces them
 * with safe placeholders before emission. Runs only in production to
 * avoid masking values during development/debugging.
 *
 * Patterns detected:
 *   - Email addresses
 *   - Bearer / API tokens
 *   - Common secret key formats (sk_*, key-*, etc.)
 *   - JWTs (three dot-separated base64 segments)
 *   - Password-like values in key-value contexts
 *   - Connection strings with embedded credentials
 */

const REDACTED = "[REDACTED]";

const PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
	{
		regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
		replacement: REDACTED,
	},
	{
		regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
		replacement: `Bearer ${REDACTED}`,
	},
	{
		regex: /\b(sk_(?:live|test)_[A-Za-z0-9]{10,})\b/g,
		replacement: REDACTED,
	},
	{
		regex: /\b(key-[A-Za-z0-9]{16,})\b/g,
		replacement: REDACTED,
	},
	{
		regex: /\b(whsec_[A-Za-z0-9+/=]{10,}|rk_(?:live|test)_[A-Za-z0-9]{10,})\b/g,
		replacement: REDACTED,
	},
	{
		regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g,
		replacement: REDACTED,
	},
	{
		regex: /(?<="?(?:password|passwd|secret|token|apiKey|api_key|accessToken|access_token|authorization)"?\s*[:=]\s*"?)[^",}\s]+/gi,
		replacement: REDACTED,
	},
	{
		regex: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^@]+@[^\s"',}]+/gi,
		replacement: `[CONN_STRING_${REDACTED}]`,
	},
];

export function redactSensitive(input: string): string {
	let result = input;
	for (const { regex, replacement } of PATTERNS) {
		regex.lastIndex = 0;
		result = result.replace(regex, replacement);
	}
	return result;
}
