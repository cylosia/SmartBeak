import {
	getOrgSettings,
	upsertFlag,
	upsertGuardrailProcedure,
} from "./procedures/flags-guardrails";
import { integrationsRouter } from "./procedures/integrations";

export const settingsRouter = {
	get: getOrgSettings,
	upsertFlag,
	upsertGuardrail: upsertGuardrailProcedure,
	integrations: integrationsRouter,
};
