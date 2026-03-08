import {
	createOpenAI,
	textModel as globalTextModel,
	type LanguageModel,
} from "@repo/ai";
import { getIntegrationByProvider } from "@repo/database";
import { decrypt } from "@repo/utils";

function getEncryptionSecret(): string {
	const secret = process.env.SMARTBEAK_ENCRYPTION_KEY;
	if (!secret) {
		throw new Error(
			"SMARTBEAK_ENCRYPTION_KEY is not configured. Set it in your .env.local file.",
		);
	}
	return secret;
}

/**
 * Resolves the OpenAI text model for a SmartBeak organization.
 * If the org has a saved & enabled OpenAI integration key, uses that;
 * otherwise falls back to the global env-based model.
 */
export async function resolveTextModel(orgId: string): Promise<LanguageModel> {
	const integration = await getIntegrationByProvider(orgId, "openai");
	if (!integration?.enabled || !integration.encryptedConfig) {
		return globalTextModel;
	}

	let config: { apiKey: string };
	try {
		const configJson = await decrypt(
			integration.encryptedConfig,
			getEncryptionSecret(),
		);
		config = JSON.parse(configJson) as { apiKey: string };
	} catch (err) {
		const { logger } = await import("@repo/logs");
		logger.warn(
			"[resolveTextModel] Failed to decrypt org integration config, using global model:",
			err instanceof Error ? err.message : String(err),
		);
		return globalTextModel;
	}

	if (
		typeof config.apiKey !== "string" ||
		config.apiKey.trim().length === 0
	) {
		const { logger } = await import("@repo/logs");
		logger.warn(
			"[resolveTextModel] OpenAI integration is missing an API key, using global model.",
		);
		return globalTextModel;
	}

	const provider = createOpenAI({ apiKey: config.apiKey });
	return provider("gpt-4o-mini");
}
