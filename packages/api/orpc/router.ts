import type { RouterClient } from "@orpc/server";
import { adminRouter } from "../modules/admin/router";
import { aiRouter } from "../modules/ai/router";
import { aiAgentsRouter } from "../modules/ai-agents/router";
import { contactRouter } from "../modules/contact/router";
import { enterpriseRouter } from "../modules/enterprise/router";
import { newsletterRouter } from "../modules/newsletter/router";
import { organizationsRouter } from "../modules/organizations/router";
import { paymentsRouter } from "../modules/payments/router";
import { smartbeakRouter } from "../modules/smartbeak/router";
import { usersRouter } from "../modules/users/router";
import { publicProcedure } from "./procedures";

export const router = publicProcedure.router({
	admin: adminRouter,
	newsletter: newsletterRouter,
	contact: contactRouter,
	organizations: organizationsRouter,
	users: usersRouter,
	payments: paymentsRouter,
	ai: aiRouter,
	aiAgents: aiAgentsRouter,
	smartbeak: smartbeakRouter,
	enterprise: enterpriseRouter,
});

export type ApiRouterClient = RouterClient<typeof router>;
