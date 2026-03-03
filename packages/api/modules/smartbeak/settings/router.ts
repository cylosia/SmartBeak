import {
  getOrgSettings,
  upsertFlag,
  upsertGuardrailProcedure,
} from "./procedures/flags-guardrails";

export const settingsRouter = {
  get: getOrgSettings,
  upsertFlag,
  upsertGuardrail: upsertGuardrailProcedure,
};
