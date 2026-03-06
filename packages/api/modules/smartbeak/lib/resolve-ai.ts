import {
	createOpenAI,
	textModel as globalTextModel,
	type LanguageModel,
} from "@repo/ai";
import { getIntegrationByProvider } from "@repo/database";
import { decrypt } from "@repo/utils";

const ENCRYPTION_SECRET = process.env.SMARTBEAK_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
if (!ENCRYPTION_SECRET) {
  throw new Error("SMARTBEAK_ENCRYPTION_KEY or BETTER_AUTH_SECRET is required for encryption");
}

/**
 * Resolves the OpenAI text model for a SmartBeak organization.
 * If the org has a saved & enabled OpenAI integration key, uses that;
 * otherwise falls back to the global env-based model.
 */
export async function resolveTextModel(
	orgId: string,
): Promise<LanguageModel> {
	const integration = await getIntegrationByProvider(orgId, "openai");
	if (!integration?.enabled || !integration.encryptedConfig) {
		return globalTextModel;
	}

	let config: { apiKey: string };
	try {
		const configJson = await decrypt(integration.encryptedConfig, ENCRYPTION_SECRET);
		config = JSON.parse(configJson) as { apiKey: string };
	} catch (err) {
		const { logger } = await import("@repo/logs");
		logger.warn("[resolveTextModel] Failed to decrypt org integration config, using global model:", (err as Error).message);
		return globalTextModel;
	}

	const provider = createOpenAI({ apiKey: config.apiKey });
	return provider("gpt-4o-mini");
}
