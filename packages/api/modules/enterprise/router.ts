import { enterpriseAuditRouter } from "./audit/router";
import { enterpriseBillingRouter } from "./billing/router";
import { ssoRouter } from "./sso/router";
import { teamsRouter } from "./teams/router";

export const enterpriseRouter = {
	teams: teamsRouter,
	sso: ssoRouter,
	audit: enterpriseAuditRouter,
	billing: enterpriseBillingRouter,
};
