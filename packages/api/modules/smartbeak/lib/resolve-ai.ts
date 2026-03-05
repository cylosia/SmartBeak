import {
	createOpenAI,
	textModel as globalTextModel,
	type LanguageModel,
} from "@repo/ai";
import { getIntegrationByProvider } from "@repo/database";
import { decrypt } from "@repo/utils";

const ENCRYPTION_SECRET = process.env.BETTER_AUTH_SECRET ?? "";

/**
 * Resolves the OpenAI text model for a SmartBeak organization.
 * If the org has a saved & enabled OpenAI integration key, uses that;
 * otherwise falls back to the global env-based model.
 */
export async function resolveTextModel(
	orgId: string,
): Promise<LanguageModel> {
	if (!ENCRYPTION_SECRET) {
		return globalTextModel;
	}

	const integration = await getIntegrationByProvider(orgId, "openai");
	if (!integration?.enabled || !integration.encryptedConfig) {
		return globalTextModel;
	}

	const configJson = decrypt(integration.encryptedConfig, ENCRYPTION_SECRET);
	const config = JSON.parse(configJson) as { apiKey: string };

	const provider = createOpenAI({ apiKey: config.apiKey });
	return provider("gpt-4o-mini");
}
